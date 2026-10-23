-- Rocket tree: object tree WITHOUT a trunk. Big rocket on a launch pad, smoke at the feet, short roots under the pad.
local X=require(game.ServerStorage.TreeKitExtras:Clone()) local K=X.K
local H,S=X.hex,X.shade
local O=Vector3.new(44,0.67,1258)
local ctx=K.new("Rocket_Tree_BlockForge",O) local g=ctx.g
local wood,WH,GR,RED,BLU,GLASS,FL1,FL2,MET,YEL,BLK=H("#6e4b33"),H("#f4f4f6"),H("#cfd3da"),H("#e2453c"),H("#3d6fd6"),H("#5ec8f2"),H("#ffd84d"),H("#ff9a2e"),H("#4a4f5a"),H("#f6c945"),H("#2a2a30")
local function v(x,y,z) return O+Vector3.new(x,y,z) end
local E=0.12
local function octX(gr,name,c,r,t,col) for i=0,3 do K.part(gr,name,CFrame.new(c)*CFrame.Angles(math.rad(45*i),0,0),Vector3.new(t-0.02*i,2*r,2*r*0.4142),col) end end
X.roots2(g("Roots"),O,1.5,S(wood,0.92),6,0.8,3.0,0.35,false)   -- r0=3.0: roots start at the pad edge
local Pd=g("Pad")
K.oct(Pd,"Pad",v(0,0.3,0),3.6,0.6+E,MET)
K.oct(Pd,"Hazard",v(0,0.75,0),3.3,0.35+E,YEL)
X.octSpots(Pd,"HazardStripe",v(0,0.75,0),3.3,0.35,{0,2,4,6},BLK,0.9)
K.oct(Pd,"Deck",v(0,1.1,0),2.9,0.4+E,S(MET,1.25))
local Sm=g("Smoke")
for i=0,7 do local a=math.rad(45*i+20) local d=Vector3.new(math.sin(a),0,math.cos(a))
  X.pillow(Sm,"Puff",CFrame.new(v(0,1.9+0.35*(i%2),0)+d*(3.2+0.3*(i%3)))*CFrame.Angles(0,a,0),Vector3.new(1.8+0.3*(i%2),1.4+0.3*(i%3),1.8),i%2==0 and WH or GR,{"top","left","right","front","back"}) end
local R=g("Rocket")
K.oct(R,"Flame",v(0,1.6,0),0.8,0.7+E,FL1)
K.oct(R,"Flame",v(0,2.2,0),1.25,0.6+E,FL2)
K.oct(R,"Nozzle",v(0,2.75,0),1.5,0.7+E,MET)
K.oct(R,"Body",v(0,7.6,0),2.3,9.0,WH)
K.oct(R,"Band",v(0,4.0,0),2.4,0.7,RED)
K.oct(R,"Band",v(0,11.4,0),2.4,0.5,BLU)
K.oct(R,"Band",v(0,8.4,0),2.36,0.35,S(GR,0.95))
X.octSpots(R,"Rivet",v(0,4.0,0),2.4,0.7,{0,1,2,3,4,5,6,7},S(MET,1.6),0.35)
for _,s in ipairs({1,-1}) do
  for j,y in ipairs({9.9,6.9}) do
    octX(R,"Porthole",v(2.32*s,y,0),j==1 and 0.95 or 0.7,0.4,MET)
    octX(R,"Glass",v(2.42*s,y,0),j==1 and 0.65 or 0.45,0.5,GLASS)
    K.part(R,"Shine",CFrame.new(v(2.7*s,y+0.25,0.25)),Vector3.new(0.2,0.3,0.3),WH) end
end
K.part(R,"Hatch",CFrame.new(v(0,5.6,2.32)),Vector3.new(1.4,1.8,0.3),S(GR,0.9))
for i,n in ipairs({{1.95,12.4},{1.5,13.3},{1.0,14.1},{0.55,14.8},{0.3,15.3}}) do K.oct(R,"Nose",v(0,n[2],0),n[1],0.85+E,S(RED,1+0.04*(i-1))) end
for k=0,3 do local a=math.rad(90*k+45) local d=Vector3.new(math.sin(a),0,math.cos(a))
  K.seg(R,"Fin",v(0,6.2,0)+d*2.1,v(0,1.7,0)+d*3.4,0.45,2.2,RED,{roll=0})
  K.seg(R,"FinTip",v(0,2.4,0)+d*3.25,v(0,1.35,0)+d*3.55,0.46,1.2,S(RED,0.85),{roll=0})
  K.part(R,"FinStripe",CFrame.lookAt(v(0,4.4,0)+d*2.75,v(0,4.4,0)+d*4),Vector3.new(0.5,0.6,0.9),WH)
end
return X.finish(ctx)
