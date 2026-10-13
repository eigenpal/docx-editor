"""Generate the Grafana dashboards in grafana/.

Run `python3 assets/observability/generate.py` after a change, then `bun run format`, and commit
the output.
Each panel uses only the metrics in docs/site/content/telemetry/metrics.mdx.
"""
import json
from pathlib import Path

OUT = Path(__file__).parent / 'grafana'
DS = {'type': 'prometheus', 'uid': '${datasource}'}
DOCS = 'https://docx-editor.dev/docs/2.x'
ISSUES = 'https://github.com/eigenpal/docx-editor/issues/new/choose'
TELEMETRY_DOCS = f'{DOCS}/telemetry'
INTERACTION = 'docx_editor_editor_interaction_duration_seconds'
APP_OPEN_FAILURES = 'open.failed|open.unsupported-source|open.invalid-limits'
EXPECTED_REFUSALS = 'edit.stale-target|edit.read-only|edit.protected-content|edit.refresh-in-progress|edit.collaboration-not-ready'

# Selectors. `F` filters editor metrics by app, environment, and versions; `S` filters server
# metrics by server job and instance.
F = 'job=~"$job",deployment_environment=~"$env",app_version=~"$version",docx_editor_version=~"$editor_version"'
# Every summary number covers the selected time range.
W = '$__range'
# The scrape target label that marks a collaboration server. See README.md.
COLLAB_TARGET = 'docx_editor="collaboration"'
S = f'job=~"$server_job",instance=~"$instance",{COLLAB_TARGET}'


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
    defaults = {'unit': unit, 'noValue': no_value, 'color': {'mode': 'fixed', 'fixedColor': 'text'}}
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
           panel_links=(), fill=10, legend_calcs=(), dashed=()):
    custom = {'drawStyle': 'line', 'lineWidth': 2, 'fillOpacity': fill, 'spanNulls': False,
              'showPoints': 'never', 'stacking': {'mode': stack or 'none'}}
    defaults = {'unit': unit, 'custom': custom, 'color': {'mode': 'palette-classic'}}
    if minimum is not None:
        defaults['min'] = minimum
    if maximum is not None:
        defaults['max'] = maximum
    return {'type': 'timeseries', 'title': title, 'description': description,
            'targets': [target(e, l, ref=chr(65 + i)) for i, (e, l) in enumerate(queries)],
            'links': links(*panel_links),
            'fieldConfig': {'defaults': defaults, 'overrides': [
                {'matcher': {'id': 'byName', 'options': name},
                 'properties': [{'id': 'custom.lineStyle', 'value': {'fill': 'dash', 'dash': [10, 6]}}]}
                for name in dashed]},
            'options': {'legend': {'displayMode': 'table' if legend_calcs else 'list', 'placement': 'bottom',
                                   'calcs': list(legend_calcs)},
                        'tooltip': {'mode': 'multi', 'sort': 'desc'}}}


COLUMN_NAMES = {'code': 'Code', 'cause': 'Engine cause', 'part': 'Part', 'operation': 'Operation',
                'change_kind': 'Change kind', 'reason': 'Reason'}


def top_table(title, expr, key, description, code_links=True, no_value='No recorded events in this range'):
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
    for label, name in COLUMN_NAMES.items():
        properties = [{'id': 'displayName', 'value': name}]
        if label == 'cause':
            properties.append({'id': 'mappings', 'value': [
                {'type': 'value', 'options': {'none': {'text': 'Not supplied'}}}]})
        overrides.append({'matcher': {'id': 'byName', 'options': label}, 'properties': properties})
    exclude = {'Time': True}
    if code_links:
        overrides.append({'matcher': {'id': 'byName', 'options': 'anchor'},
                          'properties': [{'id': 'custom.hidden', 'value': True}]})
    return {'type': 'table', 'title': title, 'description': description,
            # Servers declare known series at zero; a table lists only what happened.
            'targets': [target(f'topk(10, {expr} > 0)', instant=True, fmt='table')],
            'transformations': [{'id': 'organize', 'options': {'excludeByName': exclude, 'indexByName': {key: 0}}},
                                {'id': 'sortBy', 'options': {'sort': [{'field': 'Value', 'desc': True}]}}],
            'fieldConfig': {'defaults': {'noValue': no_value, 'custom': {'align': 'auto'}}, 'overrides': overrides},
            'options': {'showHeader': True, 'cellHeight': 'sm', 'footer': {'show': False}}}


def text(content):
    return {'type': 'text', 'title': '', 'options': {'mode': 'markdown', 'content': content},
            'transparent': True, 'datasource': None}


def quantile(metric, p, by='le', selector=F, window='$__rate_interval'):
    return f'histogram_quantile({p}, sum by ({by}) (rate({metric}_bucket{{{selector}}}[{window}])))'


def variable(name, label, query, all_value='.*'):
    """A multi-value filter. With `all_value=None`, All matches only the listed values."""
    out = {'name': name, 'label': label, 'type': 'query', 'datasource': DS,
           'query': {'query': query, 'refId': name}, 'definition': query, 'refresh': 2,
           'includeAll': True, 'multi': True, 'sort': 1,
           'current': {'selected': True, 'text': ['All'], 'value': ['$__all']}}
    if all_value is not None:
        out['allValue'] = all_value
    return out


DATASOURCE = {'name': 'datasource', 'label': 'Data source', 'type': 'datasource', 'query': 'prometheus',
              'refresh': 1, 'includeAll': False, 'multi': False, 'current': {}}


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
# Opens: successful opens out of successful opens plus failures the app causes; broken files are out.
# A missing numerator is zero only when the denominator has opens.
opened = f'sum(increase(docx_editor_document_opens_total{{{F},outcome="opened"}}[{W}]))'
counted_opens = f'sum(increase(docx_editor_document_opens_total{{{F},code=~"none|{APP_OPEN_FAILURES}"}}[{W}]))'
open_ok = f'({opened} or {counted_opens} * 0) / {counted_opens}'
# A zero that means "nothing happened" only while editors report; otherwise no data.
reporting = f'sum(increase({INTERACTION}_count{{{F}}}[{W}])) * 0'
b = Board()
b.row('At a glance')
ESTIMATE = (' Estimated from the timing bands. The highest finite band ends at 1 s, so a value of 1 s means'
            ' the percentile is in the over 1 s band; see Presses over 1 s.')
b.add(stat('Input delay, 95th percentile', f'histogram_quantile(0.95, sum by (le) (increase({INTERACTION}_bucket{{{F}}}[{W}])))', 's',
           'Time from a key press or click on the pages to the next frame on screen, over the selected range. 95 in 100 presses were faster.' + ESTIMATE,
           decimals=0), 5, 4)
b.add(stat('Input delay, median', f'histogram_quantile(0.5, sum by (le) (increase({INTERACTION}_bucket{{{F}}}[{W}])))', 's',
           'Time from a key press or click on the pages to the next frame on screen, over the selected range. Half the presses were faster.' + ESTIMATE,
           decimals=0), 5, 4)
b.add(stat('Presses over 1 s', f'1 - sum(increase({INTERACTION}_bucket{{{F},le="1"}}[{W}])) / sum(increase({INTERACTION}_count{{{F}}}[{W}]))', 'percentunit',
           'Share of timed presses that took more than 1 s to reach the screen, over the selected range. The percentiles cannot measure these presses.',
           decimals=2), 4, 4)
b.add(stat('Opens succeeding', open_ok, 'percentunit',
           'Successful opens out of successful opens plus failures the app causes, over the selected range. Broken files are left out; see Refused files.',
           decimals=2, no_value='No opens'), 5, 4)
b.add(stat('Open time, 95th percentile', f'histogram_quantile(0.95, sum by (le) (increase(docx_editor_document_open_duration_seconds_bucket{{{F}}}[{W}])))', 's',
           'From the start of an open to the first laid-out page, for successful opens over the selected range. Estimated from the timing bands.',
           decimals=0, no_value='No opens'), 5, 4)
b.add(stat('Sources reporting, last 5 minutes', f'count(count by (job, instance) (rate({INTERACTION}_count{{{F}}}[5m]) > 0)) or vector(0)', 'short',
           'Distinct metric sources (job and instance) that sent timings in the last 5 minutes. With a random service.instance.id per page, as in the examples, each source is one open page, and a reload is a new one. A collector that aggregates browsers reports fewer sources. Zero while people edit means telemetry stopped, not that editing is healthy.'), 8, 4)
b.add(stat('Unexpected refusals per 1,000 presses',
           f'1000 * (sum(increase(docx_editor_edit_rejections_total{{{F},code!~"{EXPECTED_REFUSALS}"}}[{W}])) or {reporting}) / sum(increase({INTERACTION}_count{{{F}}}[{W}]))',
           'none', 'Refusals other than expected ones (read-only, protected, stale target), for every 1,000 timed presses, over the selected range.',
           decimals=2), 8, 4)
b.add(stat('Dropped telemetry events', f'round(sum(increase(docx_editor_telemetry_dropped_events_total{{{F}}}[{W}]))) or {reporting}',
           'short', 'Events the privacy check dropped. Not zero usually means core and telemetry versions differ. No data means no editor reported.', decimals=0), 8, 4)

b.row('Interaction')
b.add(series('Input delay', [(quantile(INTERACTION, 0.5), 'median'), (quantile(INTERACTION, 0.95), '95th percentile'),
                             (quantile(INTERACTION, 0.99), '99th percentile')], 's',
             'Key press or click to the next frame on screen: the delay a person feels.' + ESTIMATE), 12, 8)
b.add(series('Presses timed', [(f'60 * sum(rate({INTERACTION}_count{{{F}}}[$__rate_interval]))', 'presses per minute')],
             'short', 'Key presses and clicks timed, per minute. Shows how much editing the other panels describe.'), 12, 8)
BANDS = [('0.016', None, 'up to 16 ms'), ('0.033', '0.016', '16 to 33 ms'), ('0.05', '0.033', '33 to 50 ms'),
         ('0.1', '0.05', '50 to 100 ms'), ('0.2', '0.1', '100 to 200 ms'), ('0.5', '0.2', '200 to 500 ms'),
         ('1', '0.5', '500 ms to 1 s'), ('+Inf', '1', 'over 1 s')]


def band(upper, lower, metric=INTERACTION):
    top = f'sum(rate({metric}_bucket{{{F},le="{upper}"}}[$__rate_interval]))'
    return top if lower is None else f'{top} - sum(rate({metric}_bucket{{{F},le="{lower}"}}[$__rate_interval]))'


bands = series('Presses by delay band', [(band(u, l), legend) for u, l, legend in BANDS], 'percent',
               'Share of presses in each delay band. Growth in the upper bands means editing got slower.', stack='percent', fill=60)
b.add(bands, 12, 8)
b.add(series('Input delay by document size (95th percentile)', [(quantile(INTERACTION, 0.95, 'le, pages', selector=F + ',pages!=""'), '{{pages}} pages')], 's',
             'Large documents lay out more per edit. If only the large buckets are slow, the delay follows document size.'), 12, 8)
b.add(series('Input delay by app version (95th percentile)', [(quantile(INTERACTION, 0.95, 'le, app_version', selector=F + ',app_version!=""'), '{{app_version}}')], 's',
             'Your app releases, from the app.version attribute you send. A release slower than the one before points to it.'), 12, 8)
b.add(series('Input delay by editor version (95th percentile)', [(quantile(INTERACTION, 0.95, 'le, docx_editor_version', selector=F + ',docx_editor_version!=""'), '{{docx_editor_version}}')], 's',
             'The docx-editor packages that measured it. Compare editor upgrades.'), 12, 8)
b.add(series('Input delay, now and a week ago (95th percentile)', [
    (quantile(INTERACTION, 0.95), 'now'),
    (f'histogram_quantile(0.95, sum by (le) (rate({INTERACTION}_bucket{{{F}}}[$__rate_interval] offset 7d)))', 'a week ago')],
             's', 'The same time a week earlier. Empty until the stack has a week of data.'), 12, 8)

b.row('Engine work')
for metric, name in [('docx_editor_editor_layout_duration_seconds', 'Layout'), ('docx_editor_editor_paint_duration_seconds', 'Paint')]:
    engine = series(f'{name} passes by duration band', [(band(u, l, metric), legend) for u, l, legend in BANDS], 'percent',
                    f'Share of engine {name.lower()} passes after edits and view changes in each duration band. Each pass is timed alone, so many short passes can still add up to a slow press.',
                    stack='percent', fill=60)
    b.add(engine, 12, 7)

b.row('Documents')
b.add(series('Opens per minute', [(f'60 * sum by (outcome) (rate(docx_editor_document_opens_total{{{F}}}[$__rate_interval]))', '{{outcome}}')],
             'short', 'Documents opened and refused, per minute.'), 8, 8)
b.add(series('Open time, successful opens', [(quantile('docx_editor_document_open_duration_seconds', 0.5), 'median'),
                                            (quantile('docx_editor_document_open_duration_seconds', 0.95), '95th percentile')],
             's', 'From the start of an open to the first laid-out page, for opens that succeeded.'), 8, 8)
b.add(top_table('Refused files by reason', f'sum by (code, cause, part) (increase(docx_editor_document_opens_total{{{F},outcome="rejected"}}[$__range]))', 'code',
                'Why files did not open, most frequent first, with the engine reason and the role of the part that failed. Each code links to its hint.'), 8, 8)

b.row('Tracked changes')
b.add(stat('Refused while suggesting', f'round(sum(increase(docx_editor_edit_rejections_total{{{F},tracked="true"}}[{W}]))) or {reporting}', 'short',
           'Edits, commands, and agent batches refused while changes were tracked, over the selected range.'), 8, 4)
b.add(stat('Tracked changes skipped', f'round(sum(increase(docx_editor_review_skipped_total{{{F}}}[{W}]))) or {reporting}', 'short',
           'Tracked changes that accept, reject, or reassign requests skipped, over the selected range.'), 8, 4)
b.add(stat('Share of refusals while suggesting',
           f'(sum(increase(docx_editor_edit_rejections_total{{{F},tracked="true"}}[{W}])) or sum(increase(docx_editor_edit_rejections_total{{{F}}}[{W}])) * 0) / sum(increase(docx_editor_edit_rejections_total{{{F}}}[{W}]))',
           'percentunit', 'Refusals while changes were tracked, out of all refusals, over the selected range.', decimals=0, no_value='No refusals'), 8, 4)
b.add(top_table('Refused tracked changes by reason', f'sum by (code, cause) (increase(docx_editor_edit_rejections_total{{{F},tracked="true"}}[$__range]))', 'code',
                'Why edits were refused while changes were tracked, most frequent first, with the engine reason. Each code links to its hint.'), 12, 8)
b.add(series('Refused tracked changes per minute by source', [(f'60 * sum by (origin) (rate(docx_editor_edit_rejections_total{{{F},tracked="true"}}[$__rate_interval]))', '{{origin}}')],
             'short', 'Typing and pointer input, toolbar commands, or an editing API batch, while changes were tracked.', stack='normal'), 12, 8)
b.add(top_table('Skipped tracked changes by reason', f'sum by (code, cause, operation, change_kind) (increase(docx_editor_review_skipped_total{{{F}}}[$__range]))', 'code',
                'Tracked changes that accept, reject, or reassign requests skipped, by reason, operation, and kind of change. Each code links to its hint.'), 24, 6)

b.row('All refused edits')
b.add(top_table('Refused edits by reason', f'sum by (code, cause) (increase(docx_editor_edit_rejections_total{{{F}}}[$__range]))', 'code',
                'The public code of each refused edit, command, or tracked change, with the engine reason, most frequent first. Each code links to its hint.'), 12, 8)
b.add(series('Refused edits per minute by source', [(f'60 * sum by (origin, tracked) (rate(docx_editor_edit_rejections_total{{{F}}}[$__rate_interval]))', '{{origin}}, tracked {{tracked}}')],
             'short', 'Typing and pointer input, toolbar commands, or an editing API batch. Tracked means the person was suggesting.', stack='normal'), 12, 8)
b.add(top_table('Font substitutions by reason', f'sum by (code) (increase(docx_editor_font_failures_total{{{F}}}[$__range]))', 'code',
                'Fonts that failed to load. The editor used a substitute.'), 12, 6)
b.add(top_table('Dropped telemetry by reason', f'sum by (reason) (increase(docx_editor_telemetry_dropped_events_total{{{F}}}[$__range]))', 'reason',
                'Events the privacy check dropped, by reason.', code_links=False), 12, 6)

# Filter values come from every editor metric, so an app that only reports failed opens appears too.
EDITOR_METRICS = '__name__=~"docx_editor_(editor_interaction_duration_seconds_count|document_opens_total|edit_rejections_total|telemetry_dropped_events_total)"'
editor_vars = [
    DATASOURCE,
    variable('env', 'Environment', f'label_values({{{EDITOR_METRICS}}}, deployment_environment)'),
    variable('job', 'App', f'label_values({{{EDITOR_METRICS},deployment_environment=~"$env"}}, job)'),
    variable('version', 'App version', f'label_values({{{EDITOR_METRICS},deployment_environment=~"$env",job=~"$job"}}, app_version)'),
    variable('editor_version', 'Editor version', f'label_values({{{EDITOR_METRICS},deployment_environment=~"$env",job=~"$job"}}, docx_editor_version)'),
]
editor = dashboard(
    'docx-editor-experience', 'Editor experience',
    'How editing feels to people: input delay, engine work, opens, and refusals.',
    b, editor_vars,
    [annotation('Version started reporting', f'count by (app_version) ({INTERACTION}_count{{{F}}}) unless count by (app_version) ({INTERACTION}_count{{{F}}} offset 2m)', 'Version {{app_version}} reports and did not 2 minutes earlier: a release, or reporting resumed after a gap', 'rgba(126, 178, 109, 1)', enable=False)],
    [('Docs', TELEMETRY_DOCS), ('Report an issue', ISSUES)])

# ─── Collaboration ─────────────────────────────────────────────────────────────────────────
c = Board()
c.row('At a glance')
c.add(stat('Server', f'min(up{{{S}}})', 'none', 'Whether Prometheus can scrape the collaboration server.', mappings=[{'type': 'value', 'options': {'0': {'text': 'Down'}, '1': {'text': 'Up'}}}],
           no_value='Not scraped'), 4, 4)
c.add(stat('Stores succeeding',
           f'(sum(increase(docx_editor_collab_room_store_duration_seconds_count{{{S},outcome="success"}}[$__range])) or sum(increase(docx_editor_collab_room_store_duration_seconds_count{{{S}}}[$__range])) * 0) / sum(increase(docx_editor_collab_room_store_duration_seconds_count{{{S}}}[$__range]))',
           'percentunit', 'Share of room stores that succeeded. A failed store can lose edits on restart.', decimals=2, no_value='No stores yet'), 5, 4)
c.add(stat('Refused connections', f'round(sum(increase(docx_editor_collab_admission_rejections_total{{{S}}}[$__range]))) or ((min(up{{{S}}}) == 1) * 0)', 'short',
           'Connections the server refused at admission, as recorded in the selected range. For whether the server is scraped now, see Server.'), 5, 4)
c.add(stat('Client errors', f'round(sum(increase(docx_editor_collab_client_status_transitions_total{{job=~"$job",status="error"}}[$__range]))) or (sum(increase(docx_editor_collab_client_status_transitions_total{{job=~"$job"}}[$__range])) * 0)', 'short',
           'Times an editor reported an error status in the selected range. No data means no editor reported a status. The Client app filter selects these editors; the Server filters do not apply to them.', no_value='No client data'), 5, 4)
c.add(stat('Room limit p95, last 5 min', f'max(histogram_quantile(0.95, sum by (le, resource) (rate(docx_editor_collab_room_resource_usage_bucket{{{S}}}[5m]))))',
           'percentunit', 'The highest 95th percentile of any one room limit (nodes, relationships, parts, blob bytes) over the last 5 minutes. At 100%, a room refuses edits that need more of that resource.', decimals=0), 5, 4)

c.row('Rooms now')
for title, expr, desc in [('Rooms', f'sum(docx_editor_collab_rooms_active{{{S}}})', 'Rooms the server holds in memory.'),
                          ('People', f'sum(docx_editor_collab_participants_active{{{S}}})', 'People present in all rooms, from presence, summed over the selected instances. A person in two rooms counts twice. Instances that share rooms through Redis each count the same people, so select one instance for those.'),
                          ('Connections', f'sum(docx_editor_collab_connections_active{{{S}}})', 'Open connections. One person with two tabs is two.'),
                          ('People in the fullest room', f'max(docx_editor_collab_room_participants_max{{{S}}})', 'The largest room right now.')]:
    c.add(stat(title, expr, 'short', desc), 6, 4)
c.add(series('Rooms, people, and connections', [(f'sum(docx_editor_collab_rooms_active{{{S}}})', 'rooms'),
                                                (f'sum(docx_editor_collab_participants_active{{{S}}})', 'people'),
                                                (f'sum(docx_editor_collab_connections_active{{{S}}})', 'connections')],
             'short', 'Live totals over time. Connections are dashed, so they stay visible when they equal people.', legend_calcs=['lastNotNull'],
             dashed=['connections']), 12, 8)
c.add(series('Room memory', [(f'sum by (kind) (docx_editor_collab_rooms_memory_bytes{{{S}}})', '{{kind}}')], 'bytes',
             'Bytes all rooms hold: encoded state, blobs, and updates not yet stored.', stack='normal'), 12, 8)
c.add(series('Room limit used by resource (95th percentile)', [(f'histogram_quantile(0.95, sum by (le, resource) (rate(docx_editor_collab_room_resource_usage_bucket{{{S}}}[$__rate_interval])))', '{{resource}}')],
             'percentunit', 'Share of each room limit in use.', minimum=0, maximum=1), 12, 8)
c.add(series('Room age and idle time (median)', [
    (f'histogram_quantile(0.5, sum by (le) (rate(docx_editor_collab_room_age_seconds_bucket{{{S}}}[$__rate_interval])))', 'age'),
    (f'histogram_quantile(0.5, sum by (le) (rate(docx_editor_collab_room_idle_seconds_bucket{{{S}}}[$__rate_interval])))', 'idle')],
             's', 'How long rooms stay loaded, and the time since each room last changed.'), 12, 8)

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

c.row('Clients (filtered by Client app only)')
c.add(series('Client status changes per minute', [(f'60 * sum by (status, code) (rate(docx_editor_collab_client_status_transitions_total{{job=~"$job"}}[$__rate_interval]))', '{{status}} {{code}}')],
             'short', 'Ready, disconnected, and error statuses that editors reported, with the failure code. The Client app filter selects these editors; the Server filters do not apply to them.', stack='normal'), 12, 8)
c.add(series('Room size as clients saw it', [
    (f'sum(rate(docx_editor_collab_client_participants_sum{{job=~"$job"}}[$__rate_interval])) / sum(rate(docx_editor_collab_client_participants_count{{job=~"$job"}}[$__rate_interval]))', 'average')],
             'short', 'People in the room, sampled each time the count changed in an editor. For diagnosis; the server panels are the source of truth. The Client app filter selects these editors; the Server filters do not apply to them.'), 12, 8)

c.row('Refusals')
c.add(top_table('Refused connections by reason', f'sum by (reason) (increase(docx_editor_collab_admission_rejections_total{{{S}}}[$__range]))', 'reason',
                'Connections refused at admission, such as a failed sign-in, most frequent first.', code_links=False), 12, 6)
c.add(top_table('Refused messages by reason', f'sum by (reason) (increase(docx_editor_collab_message_refusals_total{{{S}}}[$__range]))', 'reason',
                'Messages refused before they applied, such as a room that changed generation.', code_links=False), 12, 6)

collab_vars = [
    DATASOURCE,
    # Servers come from their scrape target label, so a server that fails every scrape still
    # appears, and an unrelated target in the same job never does.
    dict(variable('server_job', 'Server', f'query_result(count by (job) (up{{{COLLAB_TARGET}}}))',
                  all_value=None), regex='/job="([^"]+)"/'),
    variable('instance', 'Server instance', f'label_values(up{{job=~"$server_job",{COLLAB_TARGET}}}, instance)'),
    variable('job', 'Client app', 'label_values(docx_editor_collab_client_status_transitions_total, job)'),
]
collab = dashboard(
    'docx-editor-collaboration', 'Collaboration',
    'Collaboration servers and the editors that join rooms: availability, rooms and people, server work, and refusals. Server filters apply to server panels; Client app applies to client panels.',
    c, collab_vars,
    [],
    [('Docs', f'{DOCS}/telemetry/servers'), ('Report an issue', ISSUES)])

for name, board in [('editor-experience.json', editor), ('collaboration.json', collab)]:
    (OUT / name).write_text(json.dumps(board, indent=2) + '\n')
print('dashboards written')
