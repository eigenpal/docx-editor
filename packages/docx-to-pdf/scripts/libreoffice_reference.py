#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Export a read-only DOCX in proposed/no-markup view through an isolated Writer profile."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from xml.sax.saxutils import escape


def basic_string(value):
    return '"' + str(value).replace('"', '""') + '"'


def convert(source: Path, output: Path, timeout=60):
    source, output = source.resolve(strict=True), output.resolve()
    if output.exists():
        raise FileExistsError('Reference output already exists: ' + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='docx-pdf-reference-') as temporary:
        profile = Path(temporary)
        command = ['soffice', '-env:UserInstallation=' + profile.as_uri(), '--headless', '--norestore']

        def run(arguments):
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(arguments, timeout)
            process = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, start_new_session=os.name == 'posix')
            def stop_owned_processes():
                try:
                    if os.name == 'posix':
                        os.killpg(process.pid, signal.SIGKILL)
                    elif process.poll() is None:
                        process.kill()
                except ProcessLookupError:
                    pass  # The private group has already exited.
            try:
                stdout, stderr = process.communicate(timeout=remaining)
            except BaseException:
                # This new session belongs only to this disposable-profile conversion.
                # Cancellation as well as timeout must reap the launcher and its children.
                stop_owned_processes()
                process.communicate()
                raise
            else:
                # A launcher can exit successfully while children with closed pipes live on.
                # They cannot outlive the disposable profile that this command owns.
                stop_owned_processes()
            return subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)

        # The first launch creates Standard and would replace a preinstalled module.
        bootstrap = profile / 'bootstrap.txt'
        bootstrap.write_text('Reference profile initialization.\n')
        bootstrap_output = profile / 'bootstrap'
        bootstrap_output.mkdir()
        initialized = run(command + ['--convert-to', 'txt', '--outdir', str(bootstrap_output), str(bootstrap)])
        if initialized.returncode:
            raise RuntimeError('Writer profile initialization failed: ' + initialized.stderr)
        basic = profile / 'user/basic'
        standard = basic / 'Standard'
        standard.mkdir(parents=True, exist_ok=True)
        (basic / 'script.xlc').write_text('''<?xml version="1.0"?>
<library:libraries xmlns:library="http://openoffice.org/2000/library"><library:library library:name="Standard" library:link="false"/></library:libraries>''')
        (standard / 'script.xlb').write_text('''<?xml version="1.0"?>
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Reference"/></library:library>''')
        error_path = profile / 'reference-error.txt'
        # This is our developer module in a disposable profile. Source-document
        # macros are disabled. Never save changes back to the opened document.
        code = f'''Sub ExportReference
On Error GoTo Failed
Dim args(3) As New com.sun.star.beans.PropertyValue
args(0).Name = "Hidden"
args(0).Value = True
args(1).Name = "ReadOnly"
args(1).Value = True
args(2).Name = "MacroExecutionMode"
args(2).Value = 0
args(3).Name = "UpdateDocMode"
args(3).Value = 0
Dim doc As Object
doc = StarDesktop.loadComponentFromURL({basic_string(source.as_uri())}, "_blank", 0, args())
doc.ShowChanges = False
doc.RedlineDisplayType = 0
Dim props(0) As New com.sun.star.beans.PropertyValue
props(0).Name = "FilterName"
props(0).Value = "writer_pdf_Export"
doc.storeToURL({basic_string(output.as_uri())}, props())
doc.close(True)
StarDesktop.terminate()
Exit Sub
Failed:
Dim f As Integer
f = FreeFile
Open {basic_string(error_path)} For Output As #f
Print #f, Error$
Close #f
StarDesktop.terminate()
End Sub
'''
        (standard / 'Reference.xba').write_text(
            '<?xml version="1.0"?><script:module xmlns:script="http://openoffice.org/2000/script" '
            'script:name="Reference" script:language="StarBasic">' + escape(code) + '</script:module>'
        )
        result = run(command + ['macro:///Standard.Reference.ExportReference()'])
        if error_path.exists():
            raise RuntimeError('Writer reference export failed: ' + error_path.read_text().strip())
        if result.returncode or not output.exists() or output.stat().st_size == 0:
            raise RuntimeError('Writer did not produce a reference PDF: ' + result.stderr)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--timeout', type=int, default=60)
    args = parser.parse_args()
    convert(args.input, args.output, args.timeout)
