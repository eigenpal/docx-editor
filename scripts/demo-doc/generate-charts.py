"""Regenerate anonymous chart XML and workbooks with XlsxWriter and lxml.

Run from any directory: python3 scripts/demo-doc/generate-charts.py
Requires optional authoring dependencies: pip install XlsxWriter lxml
"""

from datetime import datetime
from tempfile import TemporaryDirectory
import xlsxwriter
from zipfile import ZipFile
from pathlib import Path
from lxml import etree as E

OUTPUT = Path(__file__).resolve().parent / "charts"
TEMP = TemporaryDirectory()

C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
for name in ["combo", "doughnut"]:
    file = str(Path(TEMP.name) / f"{name}.xlsx")
    w = xlsxwriter.Workbook(file)
    s = w.add_worksheet("Data")
    if name == "combo":
        rows = [
            ["Month", "Planned", "Delivered", "Capacity"],
            ["Jan", 42, 38, 50],
            ["Feb", 50, 47, 55],
            ["Mar", 58, 60, 65],
            ["Apr", 64, 62, 70],
            ["May", 72, 76, 80],
            ["Jun", 84, 88, 95],
        ]
    else:
        rows = [
            ["Activity", "Effort"],
            ["Build", 42],
            ["Research", 26],
            ["Review", 20],
            ["Support", 12],
        ]
    for i, row in enumerate(rows):
        s.write_row(i, 0, row)
    data_workbook = xlsxwriter.Workbook(str(OUTPUT / f"{name}.xlsx"))
    data_workbook.set_properties(
        {
            "title": "Anonymous chart data",
            "author": "",
            "company": "",
            "created": datetime(2000, 1, 1),
        }
    )
    data_sheet = data_workbook.add_worksheet("Data")
    for i, row in enumerate(rows):
        data_sheet.write_row(i, 0, row)
    data_workbook.close()
    chart = w.add_chart({"type": "column" if name == "combo" else "doughnut"})
    if name == "combo":
        for col, color in [(1, "BDDCD9"), (2, "087F8C")]:
            chart.add_series(
                {
                    "name": ["Data", 0, col],
                    "categories": ["Data", 1, 0, 6, 0],
                    "values": ["Data", 1, col, 6, col],
                    "fill": {"color": color},
                    "border": {"none": True},
                    "gap": 95,
                }
            )
        line = w.add_chart({"type": "line"})
        line.add_series(
            {
                "name": ["Data", 0, 3],
                "categories": ["Data", 1, 0, 6, 0],
                "values": ["Data", 1, 3, 6, 3],
                "line": {"color": "E49642", "width": 2.25},
                "marker": {
                    "type": "circle",
                    "size": 5,
                    "fill": {"color": "E49642"},
                    "border": {"color": "E49642"},
                },
            }
        )
        chart.combine(line)
        chart.set_x_axis({"name": "Month"})
        chart.set_y_axis({"name": "Work units", "min": 0, "max": 100, "major_unit": 20})
    else:
        chart.add_series(
            {
                "name": ["Data", 0, 1],
                "categories": ["Data", 1, 0, 4, 0],
                "values": ["Data", 1, 1, 4, 1],
                "points": [
                    {"fill": {"color": c}, "border": {"color": "FFFFFF"}}
                    for c in ["087F8C", "48A9A6", "7A8FB5", "E49642"]
                ],
                "data_labels": {"percentage": True},
            }
        )
        chart.set_hole_size(58)
        chart.set_rotation(270)
    chart.set_title(
        {
            "name": "Delivery and capacity" if name == "combo" else "Where effort goes",
            "name_font": {"name": "Aptos", "size": 14, "color": "25364A"},
        }
    )
    chart.set_legend({"position": "bottom", "font": {"name": "Aptos", "size": 10}})
    chart.set_chartarea({"border": {"none": True}, "fill": {"color": "FFFFFF"}})
    chart.set_size({"width": 576, "height": 240})
    s.insert_chart("F1", chart)
    w.close()
    with ZipFile(file) as z:
        root = E.fromstring(z.read("xl/charts/chart1.xml"))
    for tag in ["title", "legend"]:
        for element in root.findall(".//{%s}%s" % (C, tag)):
            layout = element.find("{%s}layout" % C)
            if layout is not None:
                element.insert(
                    list(element).index(layout) + 1,
                    E.Element("{%s}overlay" % C, val="0"),
                )
    for ax in root.findall(".//{%s}catAx" % C) + root.findall(".//{%s}valAx" % C):
        scale = ax.find("{%s}scaling" % C)
        delete = E.Element("{%s}delete" % C, val="0")
        ax.insert(list(ax).index(scale) + 1, delete)
    if name == "doughnut":
        labels = root.find(".//{%s}dLbls" % C)
        assert labels is not None
        for child in list(labels):
            labels.remove(child)
        for flag, value in [
            ("showLegendKey", "0"),
            ("showVal", "0"),
            ("showCatName", "0"),
            ("showSerName", "0"),
            ("showPercent", "1"),
        ]:
            E.SubElement(labels, "{%s}%s" % (C, flag), val=value)
    ext = E.Element("{%s}externalData" % C, nsmap={"r": R})
    ext.set("{%s}id" % R, "rIdWorkbook")
    E.SubElement(ext, "{%s}autoUpdate" % C, val="0")
    printing = root.find("{%s}printSettings" % C)
    root.insert(list(root).index(printing) if printing is not None else len(root), ext)
    (OUTPUT / f"{name}.xml").write_bytes(
        E.tostring(root, encoding="UTF-8", xml_declaration=True, pretty_print=True)
    )

TEMP.cleanup()
