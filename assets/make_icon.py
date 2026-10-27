from PIL import Image, ImageDraw
import math, os
S=1024
img=Image.new("RGBA",(S,S),(0,0,0,0))
d=ImageDraw.Draw(img)
r=230
d.rounded_rectangle((0,0,S,S),radius=r,fill=(32,24,30,255))
d.rounded_rectangle((5,5,S-5,S-5),radius=r-5,outline=(64,47,57,255),width=5)
heart=Image.new("L",(S,S),0)
hd=ImageDraw.Draw(heart)
pts=[]
scale=S*0.0275
for i in range(720):
    t=2*math.pi*i/720
    x=16*math.sin(t)**3
    y=13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t)
    pts.append((S/2 + x*scale, S*0.50 - y*scale))
hd.polygon(pts, fill=255)
grad=Image.new("RGBA",(S,S))
gd=ImageDraw.Draw(grad)
for y in range(S):
    t=max(0,min(1,(y-S*0.18)/(S*0.72)))
    c=(int(238-38*t), int(87+82*t), int(108+44*t),255)
    gd.line([(0,y),(S,y)],fill=c)
img.paste(grad,(0,0),heart)
# soft highlight clipped inside heart
gl=Image.new("RGBA",(S,S),(0,0,0,0))
gg=ImageDraw.Draw(gl)
gg.ellipse((int(S*0.27),int(S*0.29),int(S*0.46),int(S*0.42)),fill=(255,255,255,40))
gl.putalpha(Image.composite(gl.getchannel("A"), Image.new("L",(S,S),0), heart))
img.alpha_composite(gl)
# sparkle
d.ellipse((int(S*0.73),int(S*0.20),int(S*0.80),int(S*0.27)),fill=(255,228,216,255))
os.makedirs("crushlens/assets",exist_ok=True)
img.save("crushlens/assets/app_icon.png")
img.save("crushlens/assets/app.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("saved")
