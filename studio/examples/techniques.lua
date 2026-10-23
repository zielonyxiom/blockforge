-- Reusable shape techniques (copy into a tree script). K = TreeKit, X = TreeKitExtras.

-- 1) Octagon disc around an arbitrary axis (lollipop, clock face, wheel, cane band)
local function octA(gr,name,c,axis,r,h,col)
  for i=0,3 do K.part(gr,name,CFrame.lookAt(c,c+axis)*CFrame.Angles(0,0,math.rad(45*i+22.5)),Vector3.new(2*r,2*r*0.4142,h-0.02*i),col) end
end

-- 2) Clean striped pole (candy cane): bands on one axis, stripes 0.05 proud -> no flicker
local function stripedPole(gr,base,height,r,c1,c2)
  local y,i=0,0
  while y<height do local h=(i%2==0) and 1.0 or 0.6
    octA(gr,"Pole",base+Vector3.new(0,y+(h+0.1)/2,0),Vector3.yAxis,(i%2==0) and r or r+0.05,h+0.1,(i%2==0) and c1 or c2)
    y=y+h i=i+1 end
end

-- 3) Flared cone / bell / horn / dome: panels spanning ring i -> ring i+1 (closed surface, no gaps)
local function flare(gr,C0,dir,prof,N,c1,c2) -- prof = {{offsetAlongDir, radius}, ...}
  dir=dir.Unit local u=dir:Cross(Vector3.yAxis).Unit local w=dir:Cross(u).Unit
  for i=1,#prof-1 do local a0,a1=prof[i],prof[i+1]
    for k=0,N-1 do local ang=math.rad(360/N*k) local rad=u*math.cos(ang)+w*math.sin(ang)
      local A=C0+dir*a0[1]+rad*a0[2] local B=C0+dir*a1[1]+rad*a1[2] local rm=(a0[2]+a1[2])/2
      K.part(gr,"Panel",CFrame.lookAt((A+B)/2,B,rad),Vector3.new(2*math.pi*rm/N*1.12,0.35,(B-A).Magnitude+0.3),(k+i)%2==0 and c1 or c2)
    end end
end
-- glass version: same, then p.Transparency=0.7 and {decals=false}

-- 4) Wing / fan of rays (butterfly, feather fan, sea fan)
local function wing(gr,root,s,rays,edge,inner,dots) -- rays = {{angleDeg,length},...}; s = side (+1/-1)
  local yaw=CFrame.Angles(0,math.rad(15*s),0)
  for i,r in ipairs(rays) do local th=math.rad(r[1]) local L=r[2]
    local dir=yaw:VectorToWorldSpace(Vector3.new(0,math.sin(th),math.cos(th)*s))
    K.seg(gr,"WingRay",root,root+dir*L,0.5,1.75,edge,{roll=0})
    K.seg(gr,"WingPanel",root+dir*0.7,root+dir*(L-0.5),0.62,1.05,inner,{roll=0})
    K.part(gr,"Dot",CFrame.lookAt(root+dir*(L-0.15),root+dir*(L+1)),Vector3.new(0.72,0.38,0.38),dots)
  end
end

-- 5) Carved face on a round object (jack-o'-lantern): features sit on the surface, facing out
local function evilFace(gr,c,r,face,glow,dark)
  local f=CFrame.lookAt(c+face*(r+0.05),c+face*5)
  for _,x in ipairs({-0.38,0.38}) do K.part(gr,"Eye",f*CFrame.new(x*r,0.28*r,0)*CFrame.Angles(0,0,math.rad(x>0 and -28 or 28)),Vector3.new(0.5*r,0.28*r,0.3),glow) end
  K.part(gr,"Grin",f*CFrame.new(0,-0.32*r,0),Vector3.new(1.3*r,0.38*r,0.3),glow)
  for i=-2,2 do K.part(gr,"Tooth",f*CFrame.new(i*0.26*r,(i%2==0 and -0.2 or -0.44)*r,-0.06),Vector3.new(0.2,0.2,0.32),dark) end
end

-- 6) Hanging item (lantern, bell, pumpkin, bat): rope overlaps BOTH the branch and the item by ~0.2
-- 7) Ground ring of props (stones, candles, mushrooms): sink them 0.2-0.3 into the ground, then X.seat(model)
-- 8) Rotate a finished group about the ground point:
--    local piv=CFrame.new(groundPos) local r=piv*CFrame.Angles(0,math.rad(90),0)
--    for _,p in ipairs(group:GetDescendants()) do if p:IsA("BasePart") then p.CFrame=r*piv:ToObjectSpace(p.CFrame) end end
