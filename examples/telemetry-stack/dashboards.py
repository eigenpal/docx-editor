"""Generate the Grafana dashboards in grafana/dashboards/ from one place.

Run `python3 examples/telemetry-stack/dashboards.py` after a change, and commit the JSON.
Each panel uses only the metrics in docs/site/content/telemetry/metrics.mdx and the recording
rules in rules.yml.
"""
import json
from pathlib import Path

OUT = Path(__file__).parent / 'grafana' / 'dashboards'
DS = {'type': 'prometheus', 'uid': 'prometheus'}
DOCS = 'https://docx-editor.dev/docs/2.x'
RUNBOOK = 'https://github.com/eigenpal/docx-editor/blob/main/examples/telemetry-stack/RUNBOOK.md'
INTERACTION = 'docx_editor_editor_interaction_duration_seconds'
APP_OPEN_FAILURES = 'open.failed|open.unsupported-source|open.invalid-limits'
EXPECTED_REFUSALS = 'edit.stale-target|edit.read-only|edit.protected-content|edit.refresh-in-progress|edit.collaboration-not-ready'

# Selectors. `F` filters editor metrics by app, environment, and version; `R` filters the
# recording rules, which keep app and environment.
F = 'job=~"$job",deployment_environment=~"$env",app_version=~"$version"'
R = 'job=~"$job",deployment_environment=~"$env"'
S = 'job=~"$server_job"'


class Board:
    def __init__(self):
        self.panels, self.y, self.x, self.row_h, self.ids = [], 0, 0, 0, 0

    def take_id(self):
        self.ids += 1
        return self.ids

    def newline(self):
        if self.x:
            self.y += self.row_h
        self.x, self.row_h = 0, 0

    def row(self, title):
        self.newline()
        self.panels.append({'type': 'row', 'title': title, 'id': self.take_id(), 'collapsed': False,
                            'gridPos': {'h': 1, 'w': 24, 'x': 0, 'y': self.y}, 'panels': []})
        self.y += 1

    def add(self, panel, w, h):
        if self.x + w > 24:
            self.newline()
        panel.update(id=self.take_id(), gridPos={'h': h, 'w': w, 'x': self.x, 'y': self.y})
        panel.setdefault('datasource', DS)
        self.panels.append(panel)
        self.x += w
        self.row_h = max(self.row_h, h)


def target(expr, legend='', instant=False, fmt=None, ref='A'):
    out = {'datasource': DS, 'expr': expr, 'legendFormat': legend, 'refId': ref}
    if instant:
        out['instant'], out['range'] = True, False
    if fmt:
        out['format'] = fmt
    return out


def steps(*pairs):
    return {'mode': 'absolute', 'steps': [{'color': c, 'value': v} for c, v in pairs]}


def links(*items):
    return [{'title': title, 'url': url, 'targetBlank': True} for title, url in items]


def stat(title, expr, unit, description, thresholds=None, decimals=None, no_value='No data',
         mappings=None, panel_links=()):
    defaults = {'unit': unit, 'noValue': no_value,
                'thresholds': thresholds or steps(('text', None)),
                'color': {'mode': 'thresholds'}}
    if decimals is not None:
        defaults['decimals'] = decimals
    if mappings:
        defaults['mappings'] = mappings
    return {'type': 'stat', 'title': title, 'description': description,
            'targets': [target(expr, instant=True)], 'links': links(*panel_links),
            'fieldConfig': {'defaults': defaults, 'overrides': []},
            'options': {'reduceOptions': {'calcs': ['lastNotNull'], 'values': False},
                        'colorMode': 'value', 'graphMode': 'none', 'textMode': 'value',
                        'justifyMode': 'center'}}


def series(title, queries, unit, description, line=None, stack=None, minimum=None, maximum=None,
           panel_links=(), fill=10):
    custom = {'drawStyle': 'line', 'lineWidth': 2, 'fillOpacity': fill, 'spanNulls': False,
              'showPoints': 'never', 'stacking': {'mode': stack or 'none'}}
    defaults = {'unit': unit, 'custom': custom, 'color': {'mode': 'palette-classic'}}
    if line is not None:
        custom['thresholdsStyle'] = {'mode': 'dashed'}
        defaults['thresholds'] = steps(('transparent', None), ('red', line))
    if minimum is not None:
        defaults['min'] = minimum
    if maximum is not None:
        defaults['max'] = maximum
    return {'type': 'timeseries', 'title': title, 'description': description,
            'targets': [target(e, l, ref=chr(65 + i)) for i, (e, l) in enumerate(queries)],
            'links': links(*panel_links),
            'fieldConfig': {'defaults': defaults, 'overrides': []},
            'options': {'legend': {'displayMode': 'list', 'placement': 'bottom'},
                        'tooltip': {'mode': 'multi', 'sort': 'desc'}}}


def top_table(title, expr, key, description, code_links=True, no_value='No events in this range'):
    """A top-10 table. With `code_links`, each code links to its hint in the diagnostics guide."""
    if code_links:
        expr = f'label_replace({expr}, "anchor", "$1-$2", "{key}", "([^.]+)\\\\.(.+)")'
    overrides = [{'matcher': {'id': 'byName', 'options': 'Value'},
                  'properties': [{'id': 'displayName', 'value': 'Count'}, {'id': 'decimals', 'value': 0},
                                 {'id': 'custom.cellOptions', 'value': {'type': 'gauge', 'mode': 'basic'}}]}]
    if code_links:
        overrides.append({'matcher': {'id': 'byName', 'options': key}, 'properties': [
            {'id': 'links', 'value': [{'title': 'Hint and action for ${__value.text}',
                                       'url': f'{DOCS}/guides/diagnostics#${{__data.fields.anchor}}',
                                       'targetBlank': True}]}]})
    exclude = {'Time': True, 'anchor': True}
    return {'type': 'table', 'title': title, 'description': description,
            'targets': [target(f'topk(10, {expr})', instant=True, fmt='table')],
            'transformations': [{'id': 'organize', 'options': {'excludeByName': exclude}},
                                {'id': 'sortBy', 'options': {'sort': [{'field': 'Value', 'desc': True}]}}],
            'fieldConfig': {'defaults': {'noValue': no_value, 'custom': {'align': 'auto'}}, 'overrides': overrides},
            'options': {'showHeader': True, 'cellHeight': 'sm', 'footer': {'show': False}}}


def alerts_table(service_filter):
    return {'type': 'table', 'title': 'Firing alerts',
            'description': 'Burn-rate and server alerts from rules.yml that fire now. Each links to its runbook section.',
            'targets': [target(f'ALERTS{{alertstate="firing",{service_filter}}}', instant=True, fmt='table')],
            'transformations': [{'id': 'organize', 'options': {'excludeByName': {
                'Time': True, 'Value': True, '__name__': True, 'alertstate': True, 'service': True}}}],
            'fieldConfig': {'defaults': {'noValue': 'No alerts firing'}, 'overrides': [
                {'matcher': {'id': 'byName', 'options': 'alertname'}, 'properties': [
                    {'id': 'links', 'value': [{'title': 'Runbook', 'url': f'{RUNBOOK}', 'targetBlank': True}]}]}]},
            'options': {'showHeader': True, 'cellHeight': 'sm'}}


def text(content):
    return {'type': 'text', 'title': '', 'options': {'mode': 'markdown', 'content': content},
            'transparent': True, 'datasource': None}


def quantile(metric, p, by='le', selector=F, window='$__rate_interval'):
    return f'histogram_quantile({p}, sum by ({by}) (rate({metric}_bucket{{{selector}}}[{window}])))'


def variable(name, label, query, all_value='.*'):
    return {'name': name, 'label': label, 'type': 'query', 'datasource': DS,
            'query': {'query': query, 'refId': name}, 'definition': query, 'refresh': 2,
            'includeAll': True, 'multi': True, 'allValue': all_value, 'sort': 1,
            'current': {'selected': True, 'text': ['All'], 'value': ['$__all']}}


def dashboard(uid, title, description, board, variables, annotations, dashboard_links):
    return {
        'uid': uid, 'title': title, 'description': description, 'tags': ['docx-editor'],
        'timezone': 'browser', 'schemaVersion': 39, 'version': 1, 'editable': True,
        'refresh': '30s', 'time': {'from': 'now-1h', 'to': 'now'}, 'graphTooltip': 1,
        'templating': {'list': variables},
        'annotations': {'list': [{'builtIn': 1, 'datasource': {'type': 'grafana', 'uid': '-- Grafana --'},
                                  'enable': True, 'hide': True, 'iconColor': 'rgba(0, 211, 255, 1)',
                                  'name': 'Annotations & Alerts', 'type': 'dashboard'}] + annotations},
        'links': [{'title': t, 'url': u, 'type': 'link', 'targetBlank': True, 'icon': 'doc'} for t, u in dashboard_links],
        'panels': board.panels,
    }


def annotation(name, expr, title, color, enable=True):
    return {'name': name, 'datasource': DS, 'enable': enable, 'iconColor': color, 'expr': expr,
            'step': '60s', 'titleFormat': title, 'tagKeys': ''}


# ─── Editor experience ─────────────────────────────────────────────────────────────────────
ok_100 = f'sum(increase({INTERACTION}_bucket{{{F},le="0.1"}}[$__range])) / sum(increase({INTERACTION}_count{{{F}}}[$__range]))'
b = Board()
b.row('Health at a glance')
b.add(stat('Presses within 100 ms', ok_100, 'percentunit',
           'Share of key presses and clicks that reached the screen within 100 ms in the selected range. Objective: 99%.',
           steps(('red', None), ('orange', 0.99), ('green', 0.995)), 2, panel_links=[('Runbook', f'{RUNBOOK}#interaction-slow')]), 6, 4)
b.add(stat('Error budget left', f'clamp_min(1 - (1 - ({ok_100})) / 0.01, -1)', 'percentunit',
           'Share of the 1% budget for slow presses that the selected range has not used. Below 0 means the objective was missed.',
           steps(('red', None), ('orange', 0), ('green', 0.5)), 0), 6, 4)
b.add(stat('Burn rate, last hour', f'max(docx:interaction_slow:ratio1h{{{R}}}) / 0.01', 'none',
           'How fast the last hour uses the budget for slow presses. 1 uses it exactly over the period; the page alert fires at 14.4.',
           steps(('green', None), ('orange', 6), ('red', 14.4)), 1, no_value='No traffic'), 6, 4)
b.add(stat('Opens succeeding',
           f'1 - (sum(increase(docx_editor_document_opens_total{{{F},outcome="rejected",code=~"{APP_OPEN_FAILURES}"}}[$__range])) or vector(0)) / sum(increase(docx_editor_document_opens_total{{{F}}}[$__range]))',
           'percentunit', 'Share of opens that did not fail for a reason the app causes. Broken files are excluded; see Refused files. Objective: 99.9%.',
           steps(('red', None), ('orange', 0.999), ('green', 0.9995)), 2, panel_links=[('Runbook', f'{RUNBOOK}#open-failed')]), 6, 4)
b.add(stat('Editors reporting now', f'count(count by (instance) (rate({INTERACTION}_count{{{F}}}[5m]) > 0)) or vector(0)', 'short',
           'Browser tabs that sent timings in the last 5 minutes. Zero while people edit means telemetry stopped, not that editing is healthy.'), 8, 4)
b.add(stat('Unexpected refusals per 1,000 presses',
           f'1000 * (sum(increase(docx_editor_edit_rejections_total{{{F},code!~"{EXPECTED_REFUSALS}"}}[$__range])) or vector(0)) / sum(increase({INTERACTION}_count{{{F}}}[$__range]))',
           'none', 'A proxy for edit reliability: refusals other than expected ones (read-only, protected, stale target), for every 1,000 timed presses.',
           steps(('green', None), ('orange', 1), ('red', 5)), 2, panel_links=[('Runbook', f'{RUNBOOK}#unexpected-refusals')]), 8, 4)
b.add(stat('Dropped telemetry events', f'round(sum(increase(docx_editor_telemetry_dropped_events_total{{{F}}}[$__range]))) or vector(0)',
           'short', 'Events the privacy check dropped. Not zero usually means core and telemetry versions differ.',
           steps(('green', None), ('orange', 1)), 0, panel_links=[('Runbook', f'{RUNBOOK}#telemetry-dropping-events')]), 8, 4)
b.add(text(f"""**Objectives** (see the [runbook]({RUNBOOK}))

| Signal | Target |
| --- | --- |
| Presses on screen within 100 ms | 99% |
| Opens succeed, broken files excluded | 99.9% |
| Successful opens within 2.5 s | 99% |

Codes link to their hint in the [diagnostics guide]({DOCS}/guides/diagnostics)."""), 8, 5)
b.add(alerts_table('service="docx-editor",slo!=""'), 16, 5)

b.row('Interaction')
b.add(series('Input delay', [(quantile(INTERACTION, 0.5), 'median'), (quantile(INTERACTION, 0.95), '95th percentile'),
                             (quantile(INTERACTION, 0.99), '99th percentile')], 's',
             'Key press or click to the next frame on screen: the delay a person feels. The dashed line is the 100 ms objective.', line=0.1), 12, 8)
b.add(series('Presses within 100 ms', [(f'sum(rate({INTERACTION}_bucket{{{F},le="0.1"}}[$__rate_interval])) / sum(rate({INTERACTION}_count{{{F}}}[$__rate_interval]))', 'within 100 ms')],
             'percentunit', 'Share of presses within the objective over time. The dashed line is the 99% target.', line=0.99, minimum=0.9, maximum=1), 12, 8)
BANDS = [('0.016', None, 'up to 16 ms'), ('0.033', '0.016', '16 to 33 ms'), ('0.05', '0.033', '33 to 50 ms'),
         ('0.1', '0.05', '50 to 100 ms'), ('0.2', '0.1', '100 to 200 ms'), ('0.5', '0.2', '200 to 500 ms'),
         ('1', '0.5', '500 ms to 1 s'), ('+Inf', '1', 'over 1 s')]


def band(upper, lower):
    top = f'sum(rate({INTERACTION}_bucket{{{F},le="{upper}"}}[$__rate_interval]))'
    return top if lower is None else f'{top} - sum(rate({INTERACTION}_bucket{{{F},le="{lower}"}}[$__rate_interval]))'


bands = series('Presses by delay band', [(band(u, l), legend) for u, l, legend in BANDS], 'percent',
               'Share of presses in each delay band. Growth in the upper bands means editing got slower.', stack='percent', fill=60)
b.add(bands, 12, 8)
b.add(series('Input delay by document size (95th percentile)', [(quantile(INTERACTION, 0.95, 'le, pages'), '{{pages}} pages')], 's',
             'Large documents lay out more per edit. If only the large buckets are slow, the delay follows document size.', line=0.1), 12, 8)
b.add(series('Input delay by version (95th percentile)', [(quantile(INTERACTION, 0.95, 'le, app_version'), '{{app_version}}')], 's',
             'Compare releases. A version that is slower than the one before points to the release.', line=0.1), 12, 8)
b.add(series('Input delay, now and a week ago (95th percentile)', [
    (quantile(INTERACTION, 0.95), 'now'),
    (f'histogram_quantile(0.95, sum by (le) (rate({INTERACTION}_bucket{{{F}}}[$__rate_interval] offset 7d)))', 'a week ago')],
             's', 'The same time a week earlier. Empty until the stack has a week of data.', line=0.1), 12, 8)

b.row('Engine work')
for metric, name in [('docx_editor_editor_layout_duration_seconds', 'Layout'), ('docx_editor_editor_paint_duration_seconds', 'Paint')]:
    b.add(series(f'{name} passes within 16 ms', [(f'sum(rate({metric}_bucket{{{F},le="0.016"}}[$__rate_interval])) / sum(rate({metric}_count{{{F}}}[$__rate_interval]))', 'within 16 ms')],
                 'percentunit', f'Share of {name.lower()} passes that fit in one frame. If input delay grows while this stays high, the time goes to your app, not the engine.',
                 minimum=0, maximum=1), 12, 7)

b.row('Documents')
b.add(series('Opens per minute', [(f'60 * sum by (outcome) (rate(docx_editor_document_opens_total{{{F}}}[$__rate_interval]))', '{{outcome}}')],
             'short', 'Documents opened and refused, per minute.'), 8, 8)
b.add(series('Open time, successful opens', [(quantile('docx_editor_document_open_duration_seconds', 0.5), 'median'),
                                            (quantile('docx_editor_document_open_duration_seconds', 0.95), '95th percentile')],
             's', 'From the start of an open to the first laid-out page, for opens that succeeded. The dashed line is the 2.5 s objective.', line=2.5), 8, 8)
b.add(top_table('Refused files by reason', f'sum by (code) (increase(docx_editor_document_opens_total{{{F},outcome="rejected"}}[$__range]))', 'code',
                'Why files did not open, most frequent first. Each code links to its hint.'), 8, 8)

b.row('Refused edits')
b.add(top_table('Refused edits by reason', f'sum by (code) (increase(docx_editor_edit_rejections_total{{{F}}}[$__range]))', 'code',
                'The public code of each refused edit, command, or tracked change, most frequent first. Each code links to its hint.'), 12, 8)
b.add(series('Refused edits per minute by source', [(f'60 * sum by (origin, tracked) (rate(docx_editor_edit_rejections_total{{{F}}}[$__rate_interval]))', '{{origin}}, tracked {{tracked}}')],
             'short', 'Typing and pointer input, toolbar commands, or an editing API batch. Tracked means the person was suggesting.', stack='normal'), 12, 8)
b.add(top_table('Font substitutions by reason', f'sum by (code) (increase(docx_editor_font_failures_total{{{F}}}[$__range]))', 'code',
                'Fonts that failed to load. The editor used a substitute.'), 12, 6)
b.add(top_table('Dropped telemetry by reason', f'sum by (reason) (increase(docx_editor_telemetry_dropped_events_total{{{F}}}[$__range]))', 'reason',
                'Events the privacy check dropped, by reason.', code_links=False, no_value='None dropped'), 12, 6)

editor_vars = [
    variable('env', 'Environment', f'label_values({INTERACTION}_count, deployment_environment)'),
    variable('job', 'App', f'label_values({INTERACTION}_count{{deployment_environment=~"$env"}}, job)'),
    variable('version', 'Version', f'label_values({INTERACTION}_count{{deployment_environment=~"$env",job=~"$job"}}, app_version)'),
]
editor = dashboard(
    'docx-editor-experience', 'Editor experience',
    'How editing feels to people: objectives and error budgets, input delay, engine work, opens, and refusals.',
    b, editor_vars,
    [annotation('New version', f'count by (app_version) ({INTERACTION}_count) unless count by (app_version) ({INTERACTION}_count offset 2m)', 'Version {{app_version}} first seen', 'rgba(126, 178, 109, 1)', enable=False),
     annotation('Alerts', 'ALERTS{alertstate="firing",service="docx-editor"}', '{{alertname}}', 'rgba(242, 73, 92, 1)')],
    [('Runbook', RUNBOOK), ('Diagnostics guide', f'{DOCS}/guides/diagnostics'), ('Metrics', f'{DOCS}/telemetry/metrics'),
     ('Traces in Jaeger', 'http://localhost:16686/search?service=telemetry-single-user'), ('Collaboration', '/d/docx-editor-collaboration')])

# ─── Collaboration ─────────────────────────────────────────────────────────────────────────
c = Board()
c.row('Health at a glance')
c.add(stat('Server', f'min(up{{{S}}})', 'none', 'Whether Prometheus can scrape the collaboration server.',
           steps(('red', None), ('green', 1)), mappings=[{'type': 'value', 'options': {'0': {'text': 'Down'}, '1': {'text': 'Up'}}}],
           no_value='Not scraped', panel_links=[('Runbook', f'{RUNBOOK}#collaboration-server-down')]), 4, 4)
c.add(stat('Stores succeeding',
           f'sum(increase(docx_editor_collab_room_store_duration_seconds_count{{{S},outcome="success"}}[$__range])) / sum(increase(docx_editor_collab_room_store_duration_seconds_count{{{S}}}[$__range]))',
           'percentunit', 'Share of room stores that succeeded. A failed store can lose edits on restart.',
           steps(('red', None), ('orange', 0.999), ('green', 1)), 2, no_value='No stores yet', panel_links=[('Runbook', f'{RUNBOOK}#room-store-failing')]), 5, 4)
c.add(stat('Refused connections', f'round(sum(increase(docx_editor_collab_admission_rejections_total{{{S}}}[$__range]))) or vector(0)', 'short',
           'Connections the server refused at admission in the selected range.', steps(('green', None), ('orange', 1))), 5, 4)
c.add(stat('Client errors', f'round(sum(increase(docx_editor_collab_client_status_transitions_total{{job=~"$job",status="error"}}[$__range]))) or vector(0)', 'short',
           'Times an editor reported an error status in the selected range.', steps(('green', None), ('orange', 1))), 5, 4)
c.add(stat('Room limit used, 95th percentile', f'histogram_quantile(0.95, sum by (le) (rate(docx_editor_collab_room_resource_usage_bucket{{{S}}}[$__range])))',
           'percentunit', 'How close rooms come to their node, relationship, part, and blob limits. Near 100% means rooms will start to refuse edits.',
           steps(('green', None), ('orange', 0.75), ('red', 0.9)), 0, no_value='No samples'), 5, 4)
c.add(alerts_table('service="docx-editor",slo=""'), 24, 4)

c.row('Rooms now')
for title, expr, desc in [('Rooms', f'sum(docx_editor_collab_rooms_active{{{S}}})', 'Rooms the server holds in memory.'),
                          ('People', f'sum(docx_editor_collab_participants_active{{{S}}})', 'People present in all rooms, from presence. A person in two rooms counts twice.'),
                          ('Connections', f'sum(docx_editor_collab_connections_active{{{S}}})', 'Open connections. One person with two tabs is two.'),
                          ('People in the fullest room', f'max(docx_editor_collab_room_participants_max{{{S}}})', 'The largest room right now.')]:
    c.add(stat(title, expr, 'short', desc), 6, 4)
c.add(series('Rooms, people, and connections', [(f'sum(docx_editor_collab_rooms_active{{{S}}})', 'rooms'),
                                                (f'sum(docx_editor_collab_participants_active{{{S}}})', 'people'),
                                                (f'sum(docx_editor_collab_connections_active{{{S}}})', 'connections')],
             'short', 'Live totals over time.'), 12, 8)
c.add(series('Room memory', [(f'sum by (kind) (docx_editor_collab_rooms_memory_bytes{{{S}}})', '{{kind}}')], 'bytes',
             'Bytes all rooms hold: encoded state, blobs, and updates not yet stored.', stack='normal'), 12, 8)
c.add(series('Room limit used by resource (95th percentile)', [(f'histogram_quantile(0.95, sum by (le, resource) (rate(docx_editor_collab_room_resource_usage_bucket{{{S}}}[$__rate_interval])))', '{{resource}}')],
             'percentunit', 'Share of each room limit in use. The dashed line marks 90%.', line=0.9, minimum=0, maximum=1), 12, 8)
c.add(series('Room age and idle time (median)', [
    (f'histogram_quantile(0.5, sum by (le) (rate(docx_editor_collab_room_age_seconds_bucket{{{S}}}[$__rate_interval])))', 'age'),
    (f'histogram_quantile(0.5, sum by (le) (rate(docx_editor_collab_room_idle_seconds_bucket{{{S}}}[$__rate_interval])))', 'idle')],
             's', 'How long rooms stay loaded, and how long since they last changed. Idle rooms hold memory for nobody.'), 12, 8)

c.row('Server work')
c.add(series('Room load and store time (95th percentile)', [
    (f'histogram_quantile(0.95, sum by (le, outcome) (rate(docx_editor_collab_room_load_duration_seconds_bucket{{{S}}}[$__rate_interval])))', 'load {{outcome}}'),
    (f'histogram_quantile(0.95, sum by (le, outcome) (rate(docx_editor_collab_room_store_duration_seconds_bucket{{{S}}}[$__rate_interval])))', 'store {{outcome}}')],
             's', 'Time to load a room into memory and to store it.'), 12, 8)
c.add(series('Stores per minute by outcome', [(f'60 * sum by (outcome) (rate(docx_editor_collab_room_store_duration_seconds_count{{{S}}}[$__rate_interval]))', '{{outcome}}')],
             'short', 'Room stores, by outcome. Any failure risks lost edits.', stack='normal'), 12, 8)
c.add(series('Updates applied', [(f'sum(rate(docx_editor_collab_updates_total{{{S}}}[$__rate_interval]))', 'updates')],
             'ops', 'Document updates the server applied to rooms, per second.'), 8, 7)
c.add(series('Update traffic', [(f'sum(rate(docx_editor_collab_update_bytes_total{{{S}}}[$__rate_interval]))', 'bytes')],
             'Bps', 'Bytes of document updates the server applied, per second.'), 8, 7)
c.add(top_table('Room migrations by outcome', f'sum by (outcome) (increase(docx_editor_collab_migrations_total{{{S}}}[$__range]))', 'outcome',
                'Rooms migrated to a newer collaboration format, by outcome.', code_links=False, no_value='No migrations'), 8, 7)

c.row('Clients')
c.add(series('Client status changes per minute', [(f'60 * sum by (status, code) (rate(docx_editor_collab_client_status_transitions_total{{job=~"$job"}}[$__rate_interval]))', '{{status}} {{code}}')],
             'short', 'Ready, disconnected, and error statuses that editors reported, with the failure code.', stack='normal'), 12, 8)
c.add(series('Room size as clients saw it', [
    (f'sum(rate(docx_editor_collab_client_participants_sum{{job=~"$job"}}[$__rate_interval])) / sum(rate(docx_editor_collab_client_participants_count{{job=~"$job"}}[$__rate_interval]))', 'average')],
             'short', 'People in the room, sampled each time the count changed in an editor. For diagnosis; the server panels are the source of truth.'), 12, 8)

c.row('Refusals')
c.add(top_table('Refused connections by reason', f'sum by (reason) (increase(docx_editor_collab_admission_rejections_total{{{S}}}[$__range]))', 'reason',
                'Connections refused at admission, such as a failed sign-in, most frequent first.', code_links=False, no_value='None refused'), 12, 6)
c.add(top_table('Refused messages by reason', f'sum by (reason) (increase(docx_editor_collab_message_refusals_total{{{S}}}[$__range]))', 'reason',
                'Messages refused before they applied, such as a room that changed generation.', code_links=False, no_value='None refused'), 12, 6)

collab_vars = [
    variable('server_job', 'Server', 'label_values(docx_editor_collab_rooms_active, job)'),
    variable('job', 'Client app', 'label_values(docx_editor_collab_client_status_transitions_total, job)'),
]
collab = dashboard(
    'docx-editor-collaboration', 'Collaboration',
    'The room server and the editors in its rooms: availability, rooms and people, server work, and refusals.',
    c, collab_vars,
    [annotation('Alerts', 'ALERTS{alertstate="firing",service="docx-editor",slo=""}', '{{alertname}}', 'rgba(242, 73, 92, 1)')],
    [('Runbook', RUNBOOK), ('Server telemetry docs', f'{DOCS}/telemetry/servers'), ('Metrics', f'{DOCS}/telemetry/metrics'),
     ('Editor experience', '/d/docx-editor-experience')])

for name, board in [('editor-experience.json', editor), ('collaboration.json', collab)]:
    (OUT / name).write_text(json.dumps(board, indent=2) + '\n')
print('dashboards written')
