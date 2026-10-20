"""Add opaque client XML to the canonical fixture without changing its drawing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[2]
source = root / 'packages/core/src/output/__tests__/fixtures/unsupported-canvas.docx'
target = Path(__file__).resolve().parent / 'public/custom-source.docx'
target.parent.mkdir(exist_ok=True)
with ZipFile(source) as before, ZipFile(target, 'w', ZIP_DEFLATED) as after:
    for info in before.infolist():
        data = before.read(info.filename)
        if info.filename == 'word/document.xml':
            xml = data.decode().replace('<w:document ', '<w:document xmlns:review="urn:consumer-review" ')
            xml = xml.replace('<w:body>', '<w:body><review:approval review:id="approval-42"><review:title>Legal approval</review:title><review:status>pending</review:status></review:approval><w:p><w:r><w:t xml:space="preserve">Approval reference: </w:t><review:reference review:id="approval-42"><review:token>LEGAL-42</review:token></review:reference><w:t xml:space="preserve"> end reference.</w:t></w:r></w:p>')
            data = xml.encode()
        after.writestr(info, data)
print(target)
