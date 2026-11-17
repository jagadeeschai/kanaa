"""Explainer graphics, overlay clips and virtual backgrounds for the MCP server, made as the editor makes them.

The defaults are the editor's one-click ones (frontend/src/editor/actions/graphics.ts and timeline/virtual-background.ts),
so an agent's graphic looks like one the person added by hand; `settings` then changes any field of the graphic.
"""
from __future__ import annotations

import copy
import uuid

KINDS = ('arrow-straight', 'arrow-curved', 'circle', 'box', 'callout', 'spotlight', 'lower-third', 'count-up', 'chapter-card',
         'bar-chart', 'line-chart', 'pie-chart', 'step-list', 'timeline-bar', 'icon', 'compare-divider', 'map', 'source')
CHOKE, WRAP = .35, .5   # The editor's Blend in one click (timeline/composite.ts DEFAULT_COMPOSITE).
DEFAULT_CHROMA = {'color': '#00b140', 'similarity': .08, 'softness': .06, 'spill': .5}
REST = {'x': .5, 'y': .5, 'scale': 1, 'opacity': 1, 'rotation': 0}

_CENTRE = {'from': [.5, .5], 'to': [.5, .5]}
DEFAULTS: dict[str, tuple[dict, str, str]] = {   # kind: (graphic, words, colour)
    'source':({'style':'documentary','from':[.5,.95],'to':[.5,.95],'width':.92,'height':.075},'Source: …','#ddb168'),
    'map':({'style':'documentary',**_CENTRE,'width':.84,'height':.76,'map_region':'tamil-nadu','map_route':True,'map_zoom':True,'map_places':[{'name':'சென்னை','lat':13.0827,'lon':80.2707},{'name':'கோயம்புத்தூர்','lat':11.0168,'lon':76.9558}]},'Map','#ffffff'),
    'lower-third': ({'style': 'clean', 'from': [.07, .78], 'to': [.07, .78], 'width': .42, 'height': .14, 'role': 'Role or organisation'}, 'Name', '#ffffff'),
    'count-up': ({'style': 'clean', **_CENTRE, 'width': .34, 'height': .2, 'count_from': 0, 'count_to': 2000, 'label': 'years', 'prefix': '', 'suffix': ''}, 'Count-up number', '#ffffff'),
    'chapter-card': ({'style': 'documentary', 'from': [.5, .5], 'to': [.08, .12], 'width': .42, 'height': .22, 'card_mode': 'full'}, 'Part 2 — சங்க காலம்', '#f5c11b'),
    'bar-chart': ({'style': 'documentary', **_CENTRE, 'width': .72, 'height': .62, 'data': [{'label': 'சென்னை', 'value': 82}, {'label': 'மதுரை', 'value': 61}, {'label': 'கோவை', 'value': 74}],
                   'chart_orientation': 'horizontal', 'highlight_index': 0, 'show_values': True, 'indian_grouping': True}, 'Bar chart', '#ffffff'),
    'line-chart': ({'style': 'documentary', **_CENTRE, 'width': .76, 'height': .62, 'line_width': .007,
                    'data': [{'label': '2022', 'value': 42}, {'label': '2023', 'value': 68}, {'label': '2024', 'value': 57}, {'label': '2025', 'value': 84}], 'show_values': True, 'indian_grouping': True}, 'Line chart', '#ffffff'),
    'pie-chart': ({'style': 'documentary', **_CENTRE, 'width': .74, 'height': .64, 'data': [{'label': 'கல்வி', 'value': 42}, {'label': 'சுகாதாரம்', 'value': 31}, {'label': 'போக்குவரத்து', 'value': 27}],
                   'donut': True, 'show_values': True}, 'Pie chart', '#ffffff'),
    'step-list': ({'style': 'documentary', **_CENTRE, 'width': .78, 'height': .78, 'steps': ['திட்டமிடுங்கள்', 'உருவாக்குங்கள்', 'பகிருங்கள்'], 'highlight_current': True}, 'Step list', '#ffffff'),
    'timeline-bar': ({'style': 'documentary', **_CENTRE, 'width': .84, 'height': .64,
                      'points': [{'date': '300 BCE', 'label': 'சங்க காலம்'}, {'date': '1947', 'label': 'விடுதலை'}, {'date': 'இன்று', 'label': 'புதிய தொடக்கம்'}]}, 'Timeline bar', '#ffffff'),
    'compare-divider': ({'style': 'clean', **_CENTRE, 'width': 1, 'height': 1, 'line_width': .004, 'split_from': 1, 'split_to': .5, 'split_delay': .3, 'split_move': 1.2,
                         'before_label': 'முன்', 'after_label': 'பின்'}, 'Before / after', '#ffffff'),
}


def graphic_item(kind: str, start: float, length: float, point: tuple[float, float], aspect: float, text: str | None = None,
                 colour: str | None = None, settings: dict | None = None) -> dict:
    """A Graphics-layer text item for `kind`, at `point` (shares of the frame) where the kind uses one; `aspect` is height / width."""
    if kind not in KINDS:
        raise ValueError(f'Unknown graphic {kind!r}. Kinds: {", ".join(KINDS)}.')
    x, y = (max(.04, min(.96, value)) for value in point)
    if kind in DEFAULTS:
        graphic, words, ink = copy.deepcopy(DEFAULTS[kind])
    elif kind == 'icon':
        graphic, words, ink = {'style': 'clean', 'from': [x, y], 'to': [x, y], 'width': .22 * aspect, 'height': .22, 'icon': 'pin', 'icon_badge': True}, 'Icon', '#ffffff'
    else:   # Arrows, highlights, callouts, spotlight: pointing at (x, y), a tail that stays a useful length at every edge.
        tail = [min(.96, x + .2) if x < .28 else x - .2, min(.96, y + .16) if y < .24 else y - .16]
        highlight = kind in ('circle', 'box'); spot = kind == 'spotlight'
        graphic = {'style': 'documentary' if highlight else 'clean', 'from': tail, 'to': [x, y], 'width': .3 if spot else .25, 'height': .42 if spot else .18, **({'dim': .6} if spot else {})}
        words, ink = ('Type your label' if kind == 'callout' else kind.replace('arrow-', '').replace('-', ' ')), ('#f5c11b' if highlight else '#ffffff')
    graphic = {'kind': kind, 'line_width': .006, **graphic, **(settings or {})}
    enter = {'preset': 'pop' if kind in ('callout', 'icon') else 'reveal', 'duration': 1.6 if kind == 'map' else .8 if kind == 'spotlight' else .65}
    exit_ = {'preset': 'reveal', 'duration': .45} if kind == 'lower-third' else {'preset': 'fade', 'duration': .4} if kind in ('count-up', 'chapter-card', 'bar-chart', 'line-chart', 'pie-chart') else None
    item = {'id': f'graphic-{uuid.uuid4().hex[:8]}', 'start': round(start, 3), 'length': round(length, 3), 'text': text or words, 'style': 'plain', 'position': 'center',
            'color': colour or ink, 'size': 44, 'transform': dict(REST), 'graphic': graphic}
    if kind != 'compare-divider':
        item['enter'] = enter
        if exit_: item['exit'] = exit_
    return item


def add_to_graphics(timeline: dict, item: dict) -> None:
    """Onto a Graphics text layer with room at that time, else a new one (below captions), as the editor's addGraphic."""
    end = item['start'] + item['length']
    for layer in timeline['layers']:
        if layer['kind'] == 'text' and layer.get('name') == 'Graphics' and all(other['start'] + other['length'] <= item['start'] + 1e-6 or end <= other['start'] + 1e-6 for other in layer['items']):
            layer['items'].append(item); return
    captions = next((index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'captions'), len(timeline['layers']))
    timeline['layers'].insert(captions, {'id': f'graphics-{uuid.uuid4().hex[:8]}', 'kind': 'text', 'name': 'Graphics', 'items': [item]})


def new_clip(media: dict, start: float, source_in: float, out: float) -> dict:
    return {'id': f'clip-{uuid.uuid4().hex[:8]}', 'media_id': media['id'], 'start': round(start, 3), 'in': round(source_in, 3), 'out': round(out, 3), 'speed': 1, 'volume': 1, 'muted': False,
            'enabled': True, 'fade_in': 0, 'fade_out': 0, 'transform': dict(REST), 'frame_locked': True}


def add_overlay(timeline: dict, clip: dict, layer_name: str = 'Overlay') -> dict:
    """On the topmost video layer that has room (not the main track), else a new layer above every video layer."""
    length = (clip['out'] - clip['in']) / clip['speed']
    videos = [index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'video']
    fits = lambda layer: all(clip['start'] + length <= other['start'] + 1e-6 or other['start'] + (other['out'] - other['in']) / other.get('speed', 1) <= clip['start'] + 1e-6 for other in layer['items'])
    for index in reversed(videos[1:]):
        if timeline['layers'][index].get('name') == layer_name and fits(timeline['layers'][index]):
            timeline['layers'][index]['items'].append(clip); return timeline['layers'][index]
    layer = {'id': f'layer-{uuid.uuid4().hex[:8]}', 'kind': 'video', 'name': layer_name, 'ripple': True, 'items': [clip]}
    timeline['layers'].insert(videos[-1] + 1, layer)
    return layer


def virtual_background(timeline: dict, clip_id: str, background: dict, screen: str | None) -> dict:
    """timeline/virtual-background.ts: the background takes the main-track clip's place (same time, silent, slowed if too
    short); the person moves to a new layer just above, keyed or cut out, with the edges blended. Returns the person's clip."""
    main = next(layer for layer in timeline['layers'] if layer['kind'] == 'video')
    index = next((i for i, clip in enumerate(main['items']) if clip['id'] == clip_id), None)
    if index is None:
        raise ValueError('Virtual background is for a clip on the main track: get_project lists them.')
    person = main['items'][index]
    length = (person['out'] - person['in']) / person.get('speed', 1)
    available = length if background.get('media_type') == 'image' else float(background.get('duration') or length)
    behind = new_clip(background, person['start'], 0, min(length, available))
    behind['id'] = person['id']
    behind.update(speed=1 if available >= length else max(.05, round(available / length, 3)), muted=True, transition_in=person.get('transition_in'),
                  fade_in=person.get('fade_in', 0), fade_out=person.get('fade_out', 0), enter=person.get('enter'), exit=person.get('exit'))
    front = {**copy.deepcopy(person), 'id': f'clip-{uuid.uuid4().hex[:8]}', 'transition_in': None,
             'chroma': {**DEFAULT_CHROMA, 'color': screen} if screen else None, 'cutout': person.get('cutout') if screen else 'remove',
             'cutout_pick': person.get('cutout_pick') if screen else None, 'composite': {'choke': CHOKE, 'wrap': WRAP, 'match': 0, 'match_gain': None}}
    main['items'][index] = behind
    timeline['layers'].insert(timeline['layers'].index(main) + 1, {'id': f'layer-{uuid.uuid4().hex[:8]}', 'kind': 'video', 'name': 'Presenter', 'ripple': True, 'items': [front]})
    return front
