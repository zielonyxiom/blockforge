-- TreeKitExtras (ModuleScript in ServerStorage): helpers on top of ServerStorage.TreeKit and TreeAudit.
-- pillow blocks, Sunflower roots, roots2 (tapered tubes resting on the ground), stepped crystals, octagon spots, finish/audit, check camera.
local K=require(game.ServerStorage.TreeKit:Clone())
local X={K=K}
function X.hex(h) return Color3.fromHex(h) end
function X.shade(c,k) local h,s,v=c:ToHSV() return Color3.fromHSV(h,s,math.clamp(v*k,0,1)) end
-- core block + plates on the listed faces, sharing its rotation (STYLE 4); plates sink 0.12 into the core
local F={top=Vector3.yAxis,bottom=-Vector3.yAxis,left=-Vector3.xAxis,right=Vector3.xAxis,front=Vector3.zAxis,back=-Vector3.zAxis}
function X.pillow(g,name,cf,size,color,faces,o)
  K.part(g,name,cf,size,color,o)
  local t=math.clamp(math.min(size.X,size.Y,size.Z)*0.22,0.3,0.7)
  for _,f in ipairs(faces or {"top","left","right","front","back"}) do local n=F[f]
    local s=Vector3.new(n.X~=0 and t or size.X*0.78,n.Y~=0 and t or size.Y*0.76,n.Z~=0 and t or size.Z*0.78)
    K.part(g,name.."Plate",cf*CFrame.new(n*size*0.5+n*(t*0.5-0.12)),s,X.shade(color,f=="bottom" and 0.88 or (f=="top" and 1.08 or 1.04)),o)
  end
end
-- the user's Sunflower roots: 4 collar blocks + chains of flat tapering slabs that swirl a little; optional buttress flare
local CHAIN={{0.62,1.15,0.34,0.6},{1.06,0.75,0.22,0.45},{1.37,0.4,0.17,0.3},{1.55,0.42,0.13,0.17}}
function X.roots(g,base,w,color,count,spread,buttress)
  count=count or 5 spread=spread or 1
  local o={var=K.WOOD}
  local function at(yaw,dist) local a=math.rad(yaw) return base+Vector3.new(math.sin(a)*dist,0,math.cos(a)*dist) end
  for i=0,3 do local yaw=90*i+10 local h=(0.5+0.06*(i%2))*w
    K.part(g,"Collar",CFrame.new(at(yaw,0.37*w)+Vector3.new(0,h/2,0))*CFrame.Angles(0,math.rad(yaw+(i%2==1 and -4 or 3)),0),Vector3.new(0.8*w,h,0.8*w),color,o) end
  local jit={0,7,-6,4,-3,8}
  for i=0,count-1 do local b=10+360/count*i+jit[i%6+1]
    for k,c in ipairs(CHAIN) do local yaw=b+9*(k-1) local sp=k>1 and spread or 1
      local th=math.max(0.25,c[3]*w)
      K.part(g,"Root",CFrame.new(at(yaw,c[1]*w*sp)+Vector3.new(0,th/2,0))*CFrame.Angles(0,math.rad(yaw-90),0),Vector3.new(c[2]*w*sp,th,math.max(0.25,c[4]*w)),X.shade(color,1-0.03*(k-1)),o) end
    if buttress then local a=math.rad(b) local d=Vector3.new(math.sin(a),0,math.cos(a))
      K.seg(g,"Buttress",base+Vector3.new(0,0.95*w,0)+d*0.3*w,base+Vector3.new(0,0.22*w,0)+d*0.95*w*spread,0.5*w,0.42*w,color,{var=K.WOOD,roll=0}) end
  end
end
-- square crystal stepping to a point (no crossed squares: those read as jagged stars)
function X.shard(g,base,dir,len,r,color,roll)
  dir=dir.Unit
  local up=math.abs(dir.Y)>0.95 and Vector3.xAxis or Vector3.yAxis
  local rot=CFrame.Angles(0,0,math.rad(roll or 0))
  local function seg(a,b,w,c) K.part(g,"Crystal",CFrame.lookAt((a+b)/2,b,up)*rot,Vector3.new(w,w,(b-a).Magnitude),c) end
  local p1,p2,p3=base+dir*len*0.62,base+dir*len*0.86,base+dir*len
  seg(base-dir*0.3,p1+dir*0.05,r,color)
  seg(p1-dir*0.05,p2+dir*0.05,r*0.66,X.shade(color,1.1))
  seg(p2-dir*0.05,p3,math.max(0.25,r*0.36),X.shade(color,1.22))
end
-- spots on the side faces of a K.oct octagon (its faces sit at multiples of 45°)
function X.octSpots(g,name,center,r,h,list,color,size)
  size=size or 0.8
  for _,k in ipairs(list) do local a=math.rad(45*k) local d=Vector3.new(math.sin(a),0,math.cos(a))
    K.part(g,name,CFrame.lookAt(center+d*(r+0.06),center+d*(r+1)),Vector3.new(size,math.min(h*0.62,size),0.3),color) end
end
-- flat plate lying on a horizontal surface at height y
function X.topSpot(g,name,center,y,dist,yaw,size,color)
  local a=math.rad(yaw) local p=center+Vector3.new(math.sin(a)*dist,0,math.cos(a)*dist)
  K.part(g,name,CFrame.new(p.X,y+0.1,p.Z)*CFrame.Angles(0,a,0),Vector3.new(size,0.3,size),color)
end
function X.finish(ctx)
  local A=require(game.ServerStorage.TreeAudit:Clone())
  ctx.model.Parent=workspace
  for _,p in ipairs(ctx.model:GetDescendants()) do if p:IsA("BasePart") then local s=p.Size p.Size=Vector3.new(math.max(s.X,0.2),math.max(s.Y,0.2),math.max(s.Z,0.2)) end end
  A.fix(ctx.model) if #A.floating(ctx.model)<=6 then A.attach(ctx.model) end A.fix(ctx.model) -- big loose chunks are a design bug: report, don't drag
  local _,s=ctx.model:GetBoundingBox()
  return A.audit(ctx.model)..string.format(" size %.1fx%.1fx%.1f",s.X,s.Y,s.Z)
end
-- camera for checks; call X.fixedCam() afterwards so the user can move again
function X.look(model,yaw,dist,h)
  local cf,s=model:GetBoundingBox() local a=math.rad(yaw) local c=workspace.CurrentCamera
  c.CameraType=Enum.CameraType.Scriptable
  c.CFrame=CFrame.lookAt(cf.Position+Vector3.new(math.sin(a)*dist,h or 2,math.cos(a)*dist),cf.Position)
end
function X.fixedCam() workspace.CurrentCamera.CameraType=Enum.CameraType.Fixed end
-- roots v2: long/short tubes curving from the trunk down to a pointed tip that rests ON the ground (never sunk = never cut off)
-- r0 = where they leave the trunk/base, h0 = how high they start; flare = collar ring hiding the trunk joint
function X.roots2(g,base,w,color,count,spread,r0,h0,flare)
  count=count or 6 spread=spread or 1 r0=r0 or 0.25*w h0=h0 or 0.9*w
  local o={var=K.WOOD}
  if flare~=false then K.oct(g,"RootFlare",base+Vector3.new(0,0.32*w,0),0.62*w,0.64*w,X.shade(color,1.05),o) end
  for i=0,count-1 do
    local long=i%2==0
    local a=math.rad(360/count*i+17+(i%3)*7)
    local d=Vector3.new(math.sin(a),0,math.cos(a)) local side=Vector3.new(d.Z,0,-d.X)
    local L=(long and 2.3 or 1.6)*w*spread
    local t0=(long and 0.46 or 0.36)*w local t1=math.max(0.25,0.12*w)
    local tipY=t1*0.5+0.03
    local p0=base+Vector3.new(0,h0*(long and 1 or 0.75),0)+d*r0
    local p1=p0+d*L*0.25-Vector3.new(0,h0*0.15,0)
    local p2=base+Vector3.new(0,tipY+0.12*w,0)+d*(r0+L*0.6)
    local p3=base+Vector3.new(0,tipY,0)+d*(r0+L)+side*(L*0.18*((i%2)*2-1))
    K.tube(g,"Root",K.bezier(p0,p1,p2,p3,4),t0,t1,X.shade(color,long and 1 or 0.92),o)
  end
end
return X
