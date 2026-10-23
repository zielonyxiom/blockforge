-- Knight (chess horse) tree: real horse head on a base in the horse's own palette, roots under the base.
-- Run with Roblox Studio MCP execute_luau (datamodel Edit). Approved by the user ("top is 100% perfect").
local X=require(game.ServerStorage.TreeKitExtras:Clone()) local K=X.K
local H,S=X.hex,X.shade
local O=Vector3.new(44,0.67,1120)
local ctx=K.new("Knight_Tree_BlockForge",O) local g=ctx.g
local W={var=K.WOOD}
local coat,mane,dark,white,gold=H("#9a5b32"),H("#2b1a12"),H("#4a3024"),H("#f1ece2"),H("#d9a63a")
local function at(x,y,z) return O+Vector3.new(x,y,z) end
local function cf(x,y,z,rx,rz) return CFrame.new(at(x,y,z))*CFrame.Angles(math.rad(rx or 0),0,math.rad(rz or 0)) end
-- base: stacked octagons, each overlapping the next by E so the stack is one piece
X.roots2(g("Roots"),O,2.0,S(coat,0.62),6,1.0,2.1,0.55,false)
local B=g("Base") local E=0.14
local function ay(y) return O+Vector3.new(0,y,0) end
K.oct(B,"Foot",ay(0.4),2.7,0.8+E,S(coat,0.7),W)
K.oct(B,"Bevel",ay(0.95),2.45,0.45+E,S(coat,0.8),W)
K.oct(B,"Ring",ay(1.3),2.2,0.35+E,mane,W)
K.oct(B,"Drum",ay(1.85),1.95,0.8+E,S(coat,0.88),W)
X.octSpots(B,"Flute",ay(1.85),1.95,0.8,{0,1,2,3,4,5,6,7},S(coat,0.7),0.5)
K.oct(B,"Bead",ay(2.45),1.6,0.45+E,S(coat,0.95),W)
K.oct(B,"Ring",ay(2.85),1.9,0.35+E,mane,W)
K.oct(B,"Skirt",ay(3.4),2.65,0.7+E,S(coat,0.9),W)
X.octSpots(B,"SkirtTrim",ay(3.4),2.65,0.7,{1,3,5,7},mane,0.6)
-- horse head (faces +z)
local Hd=g("Horse")
X.pillow(Hd,"Chest",cf(0,5.1,0.2),Vector3.new(3.4,3.4,3.8),S(coat,0.9),{"left","right","front"})
X.pillow(Hd,"Neck",cf(0,7.6,-0.1,10),Vector3.new(3.0,3.0,3.4),S(coat,0.95),{"left","right","front"})
X.pillow(Hd,"Throat",cf(0,8.7,1.4,25),Vector3.new(2.2,2.6,1.8),S(coat,0.92),{"left","right"})
X.pillow(Hd,"Neck",cf(0,9.9,0.3,18),Vector3.new(2.6,2.8,3.0),coat,{"left","right"})
X.pillow(Hd,"Cheek",cf(0,11.0,1.6),Vector3.new(2.6,2.6,2.4),S(coat,1.06),{"left","right","bottom"})
X.pillow(Hd,"Forehead",cf(0,12.6,1.2),Vector3.new(2.3,1.6,2.4),S(coat,1.03),{"left","right","top"})
local face=cf(0,11.4,3.1,40)
X.pillow(Hd,"Face",face,Vector3.new(2.0,1.7,3.2),S(coat,1.08),{"left","right","top"})
local muzzle=face*CFrame.new(0,-0.1,2.0)
X.pillow(Hd,"Muzzle",muzzle,Vector3.new(2.1,1.9,1.7),dark,{"left","right","front"})
K.part(Hd,"Lip",face*CFrame.new(0,-1.05,1.7),Vector3.new(1.6,0.8,1.3),S(dark,0.85))
for _,s in ipairs({-1,1}) do K.part(Hd,"Nostril",muzzle*CFrame.new(0.6*s,0.15,1.12),Vector3.new(0.4,0.55,0.35),H("#1e1410")) end
K.part(Hd,"Blaze",face*CFrame.new(0,1.1,0.2),Vector3.new(0.6,0.3,2.7),white)
K.part(Hd,"Star",cf(0,12.95,2.45),Vector3.new(0.8,0.8,0.3),white)
for _,s in ipairs({-1,1}) do
  K.part(Hd,"Eye",cf(1.42*s,12.3,1.7),Vector3.new(0.3,0.6,0.75),H("#1c1410"))
  K.part(Hd,"EyeShine",cf(1.5*s,12.45,1.85),Vector3.new(0.25,0.22,0.22),white)
  K.part(Hd,"Brow",cf(1.38*s,12.75,1.6),Vector3.new(0.35,0.3,1.0),S(coat,0.85))
  local ear=cf(0.6*s,14.1,0.8,-10,-8*s)
  K.part(Hd,"Ear",ear,Vector3.new(0.55,1.3,0.75),S(coat,0.9))
  K.part(Hd,"EarInner",ear*CFrame.new(0,-0.05,0.3),Vector3.new(0.3,0.9,0.3),dark)
  K.part(Hd,"EarTip",ear*CFrame.new(0,0.85,0),Vector3.new(0.35,0.55,0.45),S(coat,0.8))
end
K.part(Hd,"Noseband",face*CFrame.new(0,0,1.0),Vector3.new(2.6,2.4,0.4),H("#5a2e14"),W)
for _,s in ipairs({-1,1}) do K.part(Hd,"Ring",face*CFrame.new(1.38*s,0,1.0),Vector3.new(0.3,0.6,0.6),gold) end
K.part(Hd,"Browband",cf(0,13.25,1.55),Vector3.new(2.6,0.35,0.4),H("#5a2e14"),W)
local M=g("Mane")
K.part(M,"Forelock",cf(0,13.55,1.7,35),Vector3.new(0.9,0.5,1.1),mane)
local crest={{13.1,-0.1},{12.1,-0.55},{11.1,-1.0},{10.1,-1.45},{9.1,-1.85},{8.1,-2.15},{7.1,-2.35},{6.1,-2.45}}
for i,c in ipairs(crest) do
  X.pillow(M,"Mane",cf(0.12*((i%2)*2-1),c[1],c[2],-30),Vector3.new(1.25,1.4,1.4),S(mane,i%2==0 and 1.25 or 1),{"back"})
  if i%2==1 and i<8 then K.part(M,"Lock",cf(1.05,c[1]-0.5,c[2]+0.55,-20,12),Vector3.new(0.5,1.3,0.9),S(mane,1.15)) end
end
local res=X.finish(ctx)
-- if coplanar>0 remains: grow the reported small part by 0.08 along its axis (see clean() in the guide)
return res
