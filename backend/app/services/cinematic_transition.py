"""Diagonal white-gold wipe. Preview uses the same coordinates and Gaussian band."""
def xfade():
    d = '(X/W+.2*Y/H-(-.25+1.5*(1-P)))'
    m = f'clip(.5-({d})/.1,0,1)'
    glow = f'(.9*exp(-pow(({d})/.08,2))*sin(PI*(1-P)))'
    fill = 'if(eq(PLANE,0),242,if(eq(PLANE,1),205,if(eq(PLANE,2),255,255)))'
    return f"custom:expr='(A*(1-({m}))+B*({m}))*(1-({glow}))+({fill})*({glow})'"
