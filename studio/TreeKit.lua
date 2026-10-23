-- TreeKit: builds stud-style trees following training/STYLE.md, then runs the TreeAudit gate.
local K={}
local DECAL="rbxassetid://127473043565552"
local WOOD,LEAF="2022 Small Stud","2022 Small Universal"
K.WOOD,K.LEAF=WOOD,LEAF
local rng=Random.new()
function K.new(name,origin)
  local old=workspace:FindFirstChild(name) if old then old:Destroy() end
  local m=Instance.new("Model") m.Name=name
  local ctx={model=m,origin=origin,groups={}}
  function ctx.g(n) if not ctx.groups[n] then local f=Instance.new("Model") f.Name=n f.Parent=m ctx.groups[n]=f end return ctx.groups[n] end
  return ctx
end
local function decals(p)
  for _,face in {Enum.NormalId.Front,Enum.NormalId.Back,Enum.NormalId.Left,Enum.NormalId.Right} do
    local d=Instance.new("Decal") d.Texture=DECAL d.Color3=Color3.new(0,0,0) d.Transparency=0.85 d.ZIndex=1 d.Face=face d.Parent=p
  end
end
function K.part(group,name,cf,size,color,o)
  o=o or {}
  local p=Instance.new("Part") p.Name=name p.Anchored=true p.TopSurface=Enum.SurfaceType.Smooth p.BottomSurface=Enum.SurfaceType.Smooth
  p.Material=o.mat or Enum.Material.SmoothPlastic p.MaterialVariant=o.var or LEAF p.Size=size p.CFrame=cf p.Color=color
  if p.Material~=Enum.Material.Neon and o.decals~=false then decals(p) end
  p.Parent=group return p
end
-- box from A to B, w wide, d deep, overlapping its ends so joints never gap
function K.seg(group,name,A,B,w,d,color,o)
  local dir=(B-A) local L=dir.Magnitude dir=dir.Unit
  local up=math.abs(dir.Y)>0.95 and Vector3.zAxis or Vector3.yAxis
  local roll=(o and o.roll) or rng:NextNumber(-3,3)
  local cf=CFrame.lookAt((A+B)/2,B,up)*CFrame.Angles(0,0,math.rad(roll))
  return K.part(group,name,cf,Vector3.new(w,d or w,L+w*0.45),color,o)
end
-- chain through points, tapering w0->w1, with knuckle cubes hiding the bends
function K.tube(group,name,pts,w0,w1,color,o)
  local n=#pts-1 local list={}
  for i=1,n do local t=(i-1)/math.max(n-1,1) local w=w0+(w1-w0)*t
    table.insert(list,K.seg(group,name,pts[i],pts[i+1],w,w*0.92,color,o))
    if i<n then local kw=w*0.96 -- joint cube follows the bend so it doesn't poke out
      local d=((pts[i+1]-pts[i]).Unit+(pts[i+2]-pts[i+1]).Unit).Unit
      local up=math.abs(d.Y)>0.95 and Vector3.zAxis or Vector3.yAxis
      K.part(group,name.."Knot",CFrame.lookAt(pts[i+1],pts[i+1]+d,up),Vector3.new(kw,kw*0.92,kw),color,o) end
  end
  return list
end
function K.bezier(p0,p1,p2,p3,n)
  local t={} for i=0,n do local u=i/n local a=1-u
    table.insert(t,p0*a^3+p1*3*a*a*u+p2*3*a*u*u+p3*u^3) end return t
end
-- pillow canopy blob: core + face plates sharing its rotation (STYLE 4)
function K.blob(group,name,center,size,color,yaw,o)
  local cf=CFrame.new(center)*CFrame.Angles(math.rad(rng:NextNumber(-8,8)),math.rad(yaw or rng:NextNumber(0,90)),math.rad(rng:NextNumber(-8,8)))
  local sx,sy,sz=size.X,size.Y,size.Z local t=math.min(1.2,math.min(sx,sy,sz)*0.3)
  K.part(group,name,cf,size,color,o)
  K.part(group,name,cf*CFrame.new(0,sy/2,0),Vector3.new(sx*0.78,t,sz*0.8),color,o)
  K.part(group,name,cf*CFrame.new(0,-sy/2,0),Vector3.new(sx*0.66,t*0.8,sz*0.64),color,o)
  K.part(group,name,cf*CFrame.new(0,0,sz/2),Vector3.new(sx*0.76,sy*0.7,t),color,o)
  K.part(group,name,cf*CFrame.new(0,0.05,-sz/2),Vector3.new(sx*0.74,sy*0.72,t),color,o)
  K.part(group,name,cf*CFrame.new(sx/2,-0.05,0),Vector3.new(t,sy*0.68,sz*0.75),color,o)
  K.part(group,name,cf*CFrame.new(-sx/2,0.08,0),Vector3.new(t,sy*0.7,sz*0.77),color,o)
  return cf
end
-- root recipe (STYLE 6) around a trunk base on the ground
function K.roots(group,base,trunkW,color,n)
  local o={var=WOOD}
  local s=trunkW/2
  K.part(group,"Collar",CFrame.new(base+Vector3.new(0,trunkW*0.45,0))*CFrame.Angles(0,math.rad(4),0),Vector3.new(trunkW*1.25,trunkW*0.9,trunkW*1.25),color,o)
  local dirs={-38,33,90,-95,180,140}
  for i=1,(n or 5) do local a=math.rad(dirs[i]) local dir=Vector3.new(math.sin(a),0,math.cos(a))
    local tilt=math.rad(i==5 and 58 or 48) local L=(i==5 and 3.4 or 2.7)*s
    local A=base+dir*0.5*s+Vector3.new(0,L*math.sin(tilt)*0.95,0)
    local B=A+dir*L*math.cos(tilt)-Vector3.new(0,L*math.sin(tilt),0)+Vector3.new(0,0.15,0)
    K.seg(group,"Root",A,B,0.95*s,1.2*s,color,{var=WOOD,roll=0})
    local C=B+dir*1.4*s-Vector3.new(0,0.45*s,0)
    K.seg(group,"RootTip",B,C,0.7*s,0.72*s,color,{var=WOOD,roll=0})
  end
end
-- 4 boxes = octagon prism; heights staggered 0.02 so the rotated stud textures never share a plane
function K.oct(group,name,center,r,h,color,o)
  o=o or {} o.var=o.var or LEAF
  for i=0,3 do K.part(group,name,CFrame.new(center)*CFrame.Angles(0,math.rad(45*i),0),Vector3.new(2*r,h-0.02*i,2*r*0.4142),color,o) end
end
function K.finish(ctx)
  if ctx.yaw then local piv=CFrame.new(ctx.origin) local r=piv*CFrame.Angles(0,math.rad(ctx.yaw),0)
    for _,p in ctx.model:GetDescendants() do if p:IsA("BasePart") then p.CFrame=r*piv:ToObjectSpace(p.CFrame) end end end
  ctx.model.Parent=workspace
  local A=require(game.ServerStorage.TreeAudit:Clone())
  A.fix(ctx.model)
  return A.audit(ctx.model)
end
return K
