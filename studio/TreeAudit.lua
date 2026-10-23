-- Tree quality gate: coplanar faces (any rotation), parts hidden inside others, floating and thin parts.
local M={}
local TOL=0.02
local function parts(m) local t={} for _,p in m:GetDescendants() do if p:IsA("BasePart") then table.insert(t,p) end end return t end
local function axes(cf) return {cf.RightVector,cf.UpVector,cf.LookVector} end
local function inside(a,b) -- every corner of b inside a
  local h=a.Size/2+Vector3.one*0.01
  for x=-1,1,2 do for y=-1,1,2 do for z=-1,1,2 do
    local c=a.CFrame:PointToObjectSpace(b.CFrame:PointToWorldSpace(b.Size/2*Vector3.new(x,y,z)))
    if math.abs(c.X)>h.X or math.abs(c.Y)>h.Y or math.abs(c.Z)>h.Z then return false end
  end end end
  return true
end
local function op(m) local o=OverlapParams.new() o.FilterType=Enum.RaycastFilterType.Include o.FilterDescendantsInstances={m} return o end
-- returns list of {small, axisVector(world, of small), otherPart}
function M.coplanar(m)
  local res,seen={}, {}
  local o=op(m)
  for _,a in parts(m) do
    for _,b in workspace:GetPartsInPart(a,o) do
      if b~=a and not seen[tostring(a)..tostring(b)] and not seen[tostring(b)..tostring(a)] then
        seen[tostring(a)..tostring(b)]=true
        local A,B=axes(a.CFrame),axes(b.CFrame)
        local ha={a.Size.X/2,a.Size.Y/2,a.Size.Z/2} local hb={b.Size.X/2,b.Size.Y/2,b.Size.Z/2}
        local hit=false
        for i=1,3 do for j=1,3 do if not hit then
          local dot=A[i]:Dot(B[j])
          if math.abs(dot)>0.9995 then
            local d=(b.Position-a.Position):Dot(A[i])
            for _,sa in {-1,1} do for _,sb in {-1,1} do
              if math.abs(sa*ha[i]-(d+sb*hb[j]))<TOL then hit=true
                local small=(2*ha[i]<=2*hb[j]) and {a,i} or {b,j}
                table.insert(res,{small[1],small[2],small[1]==a and b or a})
              end
            end end
          end
        end end end
      end
    end
  end
  return res
end
function M.hidden(m)
  local res={} local o=op(m)
  for _,a in parts(m) do for _,b in workspace:GetPartsInPart(a,o) do
    if b~=a and b.Size.Magnitude<a.Size.Magnitude and inside(a,b) then res[b]=a end
  end end
  return res
end
local function bottom(p) local c=p.CFrame local h=p.Size/2
  return p.Position.Y-(math.abs(c.RightVector.Y)*h.X+math.abs(c.UpVector.Y)*h.Y+math.abs(c.LookVector.Y)*h.Z)
end
function M.floating(m) -- parts not connected (through touching parts) to the lowest part
  local ps=parts(m) if #ps==0 then return {} end
  local o=op(m)
  local low=ps[1] for _,p in ps do if bottom(p)<bottom(low) then low=p end end
  local seen,queue={},{} local gy=math.max(bottom(low)+0.2,0.15)
  for _,p in ps do if bottom(p)<=gy then seen[p]=true table.insert(queue,p) end end -- everything on the ground is a seed
  while #queue>0 do local p=table.remove(queue)
    for _,q in workspace:GetPartsInPart(p,o) do if not seen[q] then seen[q]=true table.insert(queue,q) end end
  end
  local res={} for _,p in ps do if not seen[p] then table.insert(res,p) end end
  return res
end
-- fix: delete hidden parts; push coplanar faces apart (shrink big axis, shift thin axis)
function M.fix(m)
  local nh,nc=0,0
  for b in M.hidden(m) do b:Destroy() nh+=1 end
  for pass=1,4 do
    local done={}
    for _,r in M.coplanar(m) do local p,i,other=r[1],r[2],r[3]
      if not done[p] then done[p]=true
        local v=({Vector3.xAxis,Vector3.yAxis,Vector3.zAxis})[i]
        local s=p.Size[({"X","Y","Z"})[i]]
        if s>=0.5 then p.Size-=v*(0.04+0.03*math.random(0,3)) else -- staggered so equal parts don't re-align
          local toward=other.CFrame.Position-p.Position
          local dir=(p.CFrame:VectorToWorldSpace(v):Dot(toward)>=0) and 1 or -1
          p.CFrame=p.CFrame*CFrame.new(v*0.035*dir)
        end
        nc+=1
      end
    end
  end
  return nh,nc
end
function M.audit(m)
  local ps=parts(m) local th=0
  for _,p in ps do if math.min(p.Size.X,p.Size.Y,p.Size.Z)<0.2 then th+=1 end end
  local nh=0 for _ in M.hidden(m) do nh+=1 end
  local fl=M.floating(m)
  local names={} for i=1,math.min(4,#fl) do table.insert(names,fl[i].Parent.Name.."/"..fl[i].Name) end
  return string.format("%s parts=%d coplanar=%d hidden=%d float=%d[%s] thin=%d",m.Name,#ps,#M.coplanar(m),nh,#fl,table.concat(names,","),th)
end
-- slide each floating cluster toward the nearest grounded part until it touches (fruit, leaves, bolts)
function M.attach(m)
  local fl=M.floating(m) if #fl==0 then return 0 end
  local isF={} for _,p in fl do isF[p]=true end
  local o=OverlapParams.new() o.FilterType=Enum.RaycastFilterType.Include o.FilterDescendantsInstances={m}
  local done,moved={},0
  for _,p in fl do if not done[p] then
    local cl,q={p},{p} done[p]=true
    while #q>0 do local x=table.remove(q) for _,y in workspace:GetPartsInPart(x,o) do if isF[y] and not done[y] then done[y]=true table.insert(cl,y) table.insert(q,y) end end end
    local c=Vector3.zero for _,x in cl do c+=x.Position end c/=#cl
    local best,bd=nil,1e9
    for _,g in m:GetDescendants() do if g:IsA("BasePart") and not isF[g] then local d=(g.Position-c).Magnitude if d<bd then bd,best=d,g end end end
    if best then
      local dir=(best.Position-c).Unit
      for _=1,80 do
        local touch=false
        for _,x in cl do for _,y in workspace:GetPartsInPart(x,o) do if not isF[y] then touch=true break end end if touch then break end end
        if touch then break end
        for _,x in cl do x.CFrame+=dir*0.1 end
      end
      moved+=1
    end
  end end
  return moved
end
return M
