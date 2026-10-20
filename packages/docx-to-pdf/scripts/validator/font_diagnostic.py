# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Bounded, separate shared-font experiments; never rewrite the original fixture."""
import json
import re
import tempfile
import zipfile
from pathlib import Path
from xml.dom import minidom
from xml.parsers import expat

from catalog import check_disk_budget
from evidence import digest

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
XMLNS = 'http://www.w3.org/2000/xmlns/'
PART = 'validation/font-diagnostic.json'
MAX_INPUT = 20 * 1024**2
MAX_EXPANDED = 100 * 1024**2
MAX_XML = 8 * 1024**2
SYMBOL_FAMILIES = {'symbol', 'wingdings', 'wingdings 2', 'wingdings 3', 'webdings', 'mt extra', 'zapf dingbats'}


def metadata(source):
    try:
        with zipfile.ZipFile(source) as archive:
            if PART not in archive.namelist():
                return None
            if archive.getinfo(PART).file_size > 4096:
                raise ValueError('Font diagnostic metadata exceeds its size limit')
            value = json.loads(archive.read(PART))
            if (not isinstance(value, dict) or value.get('kind') != 'shared-font' or value.get('version') != 1
                    or not re.fullmatch('[a-f0-9]{64}', value.get('originalSha256', ''))
                    or not isinstance(value.get('family'), str)):
                raise ValueError('Invalid font diagnostic provenance')
            return value
    except zipfile.BadZipFile:
        return None


def parse_xml(data):
    probe = data.replace(b'\x00', b'').upper()
    if len(data) > MAX_XML or b'<!DOCTYPE' in probe or b'<!ENTITY' in probe:
        raise ValueError('XML part exceeds limits or contains a prohibited DTD/entity')
    # Bound DOM overhead and nesting before allocating the mutable tree.
    parser = expat.ParserCreate()
    nodes = depth = 0
    def start(_name, _attrs):
        nonlocal nodes, depth
        nodes += 1
        depth += 1
        if nodes > 50000 or depth > 128:
            raise ValueError('XML structure exceeds diagnostic limits')
    def end(_name):
        nonlocal depth
        depth -= 1
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.Parse(data, True)
    return minidom.parseString(data)


def rewrite_xml(data, family, preserved):
    with parse_xml(data) as document:
        root = document.documentElement
        # Keep authored namespace prefixes, including those referenced by mc:Ignorable.
        prefix = 'vf'
        while root.hasAttribute('xmlns:' + prefix):
            prefix += 'f'
        root.setAttributeNS(XMLNS, 'xmlns:' + prefix, W)

        def create(parent, local):
            child = document.createElementNS(W, prefix + ':' + local)
            parent.appendChild(child)
            return child

        def direct(parent, local):
            return next((child for child in parent.childNodes
                         if child.nodeType == child.ELEMENT_NODE
                         and child.namespaceURI == W and child.localName == local), None)

        def ensure(parent, local):
            return direct(parent, local) or create(parent, local)

        def prepend(parent, child):
            if parent.firstChild is not child:
                parent.insertBefore(child, parent.firstChild)

        # Supply defaults even when the original relies on a machine's template.
        if root.namespaceURI == W and root.localName == 'styles':
            defaults = ensure(root, 'docDefaults')
            prepend(root, defaults)
            ensure(ensure(defaults, 'rPrDefault'), 'rPr')
        # Explicit run and numbering properties override any remaining style defaults.
        for run in list(document.getElementsByTagNameNS(W, 'r')):
            props = ensure(run, 'rPr')
            prepend(run, props)
        # Empty paragraph marks also participate in line metrics.
        for paragraph in list(document.getElementsByTagNameNS(W, 'p')):
            props = ensure(paragraph, 'pPr')
            prepend(paragraph, props)
            mark = ensure(props, 'rPr')
            anchor = direct(props, 'sectPr') or direct(props, 'pPrChange')
            if anchor:
                props.insertBefore(mark, anchor)
        for level in list(document.getElementsByTagNameNS(W, 'lvl')):
            ensure(level, 'rPr')
        for props in list(document.getElementsByTagNameNS(W, 'rPr')):
            fonts = ensure(props, 'rFonts')
            style = direct(props, 'rStyle')
            anchor = style.nextSibling if style else props.firstChild
            if anchor is not fonts:
                props.insertBefore(fonts, anchor)
        for fonts in list(document.getElementsByTagNameNS(W, 'rFonts')):
            original = [fonts.getAttributeNS(W, slot) for slot in ('ascii', 'hAnsi', 'eastAsia', 'cs')]
            symbols = [name for name in original if name.casefold() in SYMBOL_FAMILIES]
            if symbols:
                preserved.update(symbols)
                continue
            for name in ('asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme', 'csTheme'):
                if fonts.hasAttributeNS(W, name):
                    fonts.removeAttributeNS(W, name)
            for name in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
                if fonts.hasAttributeNS(W, name):
                    fonts.removeAttributeNS(W, name)
                fonts.setAttributeNS(W, prefix + ':' + name, family)
        # Embedded font mappings must not win over the shared system family.
        for name in ('embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic'):
            for node in list(document.getElementsByTagNameNS(W, name)):
                if node.parentNode.getAttributeNS(W, 'name').casefold() not in SYMBOL_FAMILIES:
                    node.parentNode.removeChild(node)
        for local in ('rPr', 'defRPr', 'endParaRPr'):
            for props in list(document.getElementsByTagNameNS(A, local)):
                for slot in ('latin', 'ea', 'cs'):
                    if not any(child.namespaceURI == A and child.localName == slot for child in props.childNodes):
                        font = document.createElementNS(A, 'vd:' + slot)
                        font.setAttributeNS(XMLNS, 'xmlns:vd', A)
                        following = {'latin': {'ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'},
                                     'ea': {'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'},
                                     'cs': {'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'}}[slot]
                        anchor = next((child for child in props.childNodes if child.namespaceURI == A and child.localName in following), None)
                        props.insertBefore(font, anchor)
        for local in ('latin', 'ea', 'cs', 'font', 'buFont'):
            for node in document.getElementsByTagNameNS(A, local):
                node.setAttribute('typeface', family)
        return document.toxml(encoding='utf-8')


def create_copy(source, root, family):
    family = family.strip()
    if not family or len(family) > 128 or any(ord(char) < 32 for char in family):
        raise ValueError('Specify a font family of 1–128 characters without control characters')
    if source.suffix.lower() != '.docx' or not 0 < source.stat().st_size <= MAX_INPUT:
        raise ValueError('Expected a DOCX of at most 20 MiB')
    original = digest(source)
    if metadata(source):
        raise ValueError('Use the original DOCX, not an existing font diagnostic')
    preserved = set()
    provenance = dict(kind='shared-font', version=1, family=family, originalSha256=original,
                      originalName=source.name[:255],
                      goalEligible=False,
                      limitations=['Availability and glyph coverage must be checked in every renderer.',
                                   'Symbol characters, equations, and raster/vector artwork may retain specialized fonts or encoding.',
                                   'Changing fonts can change wrapping; scores apply only to this diagnostic copy.'])
    directory = root / 'diagnostics'
    directory.mkdir(parents=True, exist_ok=True)
    check_disk_budget(root, extra_bytes=MAX_INPUT)
    with tempfile.TemporaryDirectory(prefix='.font-', dir=directory) as temporary:
        target = Path(temporary) / 'copy.docx'
        with zipfile.ZipFile(source) as archive, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as output:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > 4096 or len(set(names)) != len(names):
                raise ValueError('Too many or duplicate DOCX ZIP entries')
            if sum(entry.file_size for entry in entries) > MAX_EXPANDED:
                raise ValueError('Expanded DOCX exceeds 100 MiB')
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                raise ValueError('Missing DOCX package parts')
            if any(name.startswith('_xmlsignatures/') for name in names):
                raise ValueError('Use an unsigned diagnostic source')
            for entry in entries:
                if entry.filename.endswith('.xml') and entry.file_size > MAX_XML:
                    raise ValueError('XML part exceeds 8 MiB')
                data = archive.read(entry)
                if entry.filename.startswith('word/') and entry.filename.endswith('.xml'):
                    if entry.filename == 'word/document.xml':
                        with parse_xml(data) as document:
                            if document.documentElement.namespaceURI != W:
                                raise ValueError('Shared-font diagnostics currently require transitional DOCX markup')
                    data = rewrite_xml(data, family, preserved)
                elif entry.filename == '[Content_Types].xml':
                    with parse_xml(data) as document:
                        node = document.createElementNS(document.documentElement.namespaceURI,
                                                        (document.documentElement.prefix + ':' if document.documentElement.prefix else '') + 'Override')
                        node.setAttribute('PartName', '/' + PART)
                        node.setAttribute('ContentType', 'application/json')
                        document.documentElement.appendChild(node)
                        data = document.toxml(encoding='utf-8')
                output.writestr(entry, data)
            provenance['preservedSymbolFamilies'] = sorted(preserved)
            info = zipfile.ZipInfo(PART, date_time=(2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, json.dumps(provenance, sort_keys=True).encode())
        if digest(source) != original:
            raise ValueError('Source changed while preparing the font diagnostic')
        if target.stat().st_size > MAX_INPUT:
            raise ValueError('Font diagnostic exceeds the 20 MiB input limit')
        identity = digest(target)
        destination = directory / identity / 'shared-font.docx'
        destination.parent.mkdir(exist_ok=True)
        target.replace(destination)
    return dict(source=str(destination), sourceSha256=identity, diagnostic=provenance)
