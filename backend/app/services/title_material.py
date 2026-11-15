"""Title-face materials; mirrored by titleMaterial.ts, in premultiplied RGBA."""
import numpy as np
import cv2

MATERIALS = ('gold', 'chrome', 'stone', 'neon', 'glass')


def sweep_at(text, local):
    if not text.depth or not text.depth.sweep:
        return -2.
    first = text.enter.duration if text.enter else 0
    last = text.exit.duration if text.exit else 0
    entrance = first / max(1, (first + last) / text.length)
    q = (local - entrance) / .9
    return -.3 + 1.6 * q if 0 <= q <= 1 else -2.


def material_face(crop, depth, origin, letters, sweep):
    if not depth or not depth.material:
        return crop
    material = depth.material
    rows, cols = crop.shape[:2]
    x = (origin[0] + np.arange(cols, dtype=np.float32) + .5 - letters[0]) / max(1, letters[2]-letters[0])
    y = (origin[1] + np.arange(rows, dtype=np.float32) + .5 - letters[1]) / max(1, letters[3]-letters[1])
    a = crop[..., 3:4]
    # Four taps one bevel-width away: the same linear samples as the preview shader.
    radius = max(1., (letters[3]-letters[1]) * .025 * depth.bevel)
    yy, xx = np.mgrid[:rows,:cols].astype(np.float32)
    taps = [cv2.remap(a[...,0], (xx+dx).astype(np.float32), (yy+dy).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)[...,None] for dx,dy in ((radius,0),(-radius,0),(0,radius),(0,-radius))]
    edge = np.clip(a - sum(taps)/4, 0, 1) * depth.bevel
    band = (.5 + .5 * np.cos((y[:,None,None] * 2.6 - .35) * np.pi))
    palettes = {'gold': ((.32,.12,.025),(1.,.83,.36)), 'chrome': ((.12,.18,.27),(.91,.97,1.)), 'stone': ((.27,.25,.23),(.68,.65,.59)), 'neon': ((.12,.5,.65),(.35,.95,1.)), 'glass': ((.38,.65,.76),(.87,.98,1.))}
    low,high=map(np.float32,palettes[material])
    rgb = (low + (high-low)*band) * a
    shine = np.exp(-((y[:,None,None]-.3)/.055)**2) * depth.shine
    moving = np.exp(-((x[None,:,None]+(y[:,None,None]-.5)*.35-sweep)/.045)**2) if sweep > -1 else 0
    rgb = np.minimum(a, rgb + a*(shine*.55+moving*.8) + edge*.8)
    if material == 'glass':
        alpha = a*.38 + edge*.6
        rgb = np.minimum(alpha, rgb*.38+edge*.6)
        return np.concatenate((rgb,alpha),-1)
    if material in ('neon', 'stone'):
        radius = max(1., (letters[3]-letters[1])*.045)
        offsets = [(radius,0),(-radius,0),(0,radius),(0,-radius),(radius,radius),(-radius,radius),(radius,-radius),(-radius,-radius)] if material == 'neon' else [(-radius,-radius),(0,-radius),(radius,-radius)]
        halo = sum(cv2.remap(a[...,0],(xx+dx).astype(np.float32),(yy+dy).astype(np.float32),cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)[...,None] for dx,dy in offsets)/len(offsets)
        halo *= .55 if material == 'neon' else .3
        tint = np.float32((.12,.7,1.) if material == 'neon' else (0,0,0))
        return np.concatenate((rgb+halo*tint*(1-a),a+halo*(1-a)),-1)
    return np.concatenate((rgb,a),-1)
