"""A title-local glint, carried by its evaluated position, scale, tilt and rotation."""
import math
import numpy as np

def glint_face(crop, origin, letters, local):
    h=max(1,letters[3]-letters[1])
    y,x=np.mgrid[:crop.shape[0],:crop.shape[1]].astype(np.float32)
    dx=(x+origin[0]+.5-(letters[2]-.12*h))/h
    dy=(y+origin[1]+.5-(letters[1]+.2*h))/h
    a=np.clip((np.exp(-(dx/.22)**2-(dy/.012)**2)+np.exp(-(dx/.012)**2-(dy/.16)**2)+.4*np.exp(-(dx/.07)**2-(dy/.07)**2))*(.25+.75*math.sin(local*2.4)**4),0,1)[...,None]
    return np.concatenate((np.float32((1,.92,.68))*a+crop[...,:3]*(1-a),a+crop[...,3:4]*(1-a)),-1)
