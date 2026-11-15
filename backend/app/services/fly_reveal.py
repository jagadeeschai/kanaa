"""Letter-window reveals as a black inverse-alpha matte, then the regular 3D title.
The rasterizer clips its warp to the output frame even at 12x; no giant intermediate frame.
"""
import numpy as np

PRESETS = {'fly-reveal', 'fly-through-3d'}

def state_at(text, local):
    first = text.enter.duration if text.enter else 0
    last = text.exit.duration if text.exit else 0
    excess = max(1, (first+last)/text.length)
    duration_in, duration_out = first/excess, last/excess
    q = None
    if text.enter and text.enter.preset in PRESETS and local < duration_in:
        q = local/duration_in
    elif text.exit and text.exit.preset in PRESETS and local > text.length-duration_out:
        q = (text.length-local)/duration_out
    if q is None: return None
    def smooth(a,b):
        p=max(0.,min(1.,(q-a)/(b-a)));return p*p*(3-2*p)
    return smooth(.68,1.), smooth(.76,1.)

def overlay(frame, window, state):
    opened, title = state
    face = frame.astype(np.float32)/255
    mask = window[...,3:4].astype(np.float32)/255
    black = (1-mask)*(1-opened)
    a = face[...,3:4]*title
    alpha = a+black*(1-a)
    rgb = face[...,:3]*a/np.maximum(alpha,1e-6)
    return np.clip(np.concatenate((rgb,alpha),-1)*255+.5,0,255).astype(np.uint8)
