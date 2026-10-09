import bpy, bmesh, math
from mathutils import Vector
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1200
scene.render.resolution_y = 480
scene.render.resolution_percentage = 100
scene.render.image_settings.media_type = 'IMAGE'
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('ENV_world')
scene.world.color = (0.008, 0.011, 0.017)
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.009,0.013,0.02,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.25
scene.view_settings.view_transform = 'Standard'
scene.render.film_transparent = False

def material(name, color, emission=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color,1)
    shader.inputs['Roughness'].default_value = 0.48
    shader.inputs['Emission Color'].default_value = (*color,1)
    shader.inputs['Emission Strength'].default_value = emission
    return mat

ink=material('MAT_ink',(0.78,0.82,0.9),0.6)
dim=material('MAT_dim',(0.22,0.27,0.35),0.35)
faint=material('MAT_faint',(0.055,0.08,0.115),0.3)
route=material('MAT_route',(0.114,0.86,0.39),1.0)
passmat=material('MAT_passthrough',(0.89,0.54,0.095),1.0)
fail=material('MAT_failure',(0.96,0.16,0.11),1.0)
base=material('MAT_baseline',(0.28,0.37,0.93),1.0)
claude=material('MAT_claude',(0.72,0.24,0.14),0.8)
bm=bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
unit_v=[tuple(v.co) for v in bm.verts]
bm.verts.index_update()
unit_f=[tuple(v.index for v in f.verts) for f in bm.faces]
bm.free()

def dots(name, points, mats, indexes=None, parent=None):
    vertices=[]; faces=[]; slots=[]
    for i,(x,y,z,r) in enumerate(points):
        offset=len(vertices)
        vertices.extend([(x+vx*r,y+vy*r,z+vz*r) for vx,vy,vz in unit_v])
        faces.extend([tuple(offset+j for j in f) for f in unit_f])
        slots.extend([indexes[i] if indexes else 0]*len(unit_f))
    mesh=bpy.data.meshes.new(name+'_mesh')
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    scene.collection.objects.link(obj)
    for mat in mats: mesh.materials.append(mat)
    for poly,slot in zip(mesh.polygons,slots):
        poly.material_index=slot
        poly.use_smooth=True
    if parent: obj.parent=parent
    return obj

def fibonacci(count, radius):
    golden=math.pi*(3-math.sqrt(5))
    out=[]
    for i in range(count):
        z=1-2*i/(count-1)
        r=math.sqrt(1-z*z)
        out.append((math.cos(golden*i)*r*radius,math.sin(golden*i)*r*radius,z*radius))
    return out

rig=bpy.data.objects.new('RIG_pingo',None)
scene.collection.objects.link(rig)
rig.location=(-3.3,0,0.2)
pts=fibonacci(700,1.35)
body=dots('HERO_pingo_body',[(x,y,z,0.018+0.008*max(0,-y/1.35)) for x,y,z in pts],[ink,dim,faint],[0 if y<-.35 else 1 if y<.45 else 2 for x,y,z in pts],rig)
face=[]
for side in [-1,1]:
    for i in range(13):
        a=.18+math.pi*.88*i/12
        x=side*.42+math.cos(a)*.16
        z=.14+math.sin(a)*.16
        y=-math.sqrt(max(0,1.35**2-x*x-z*z))*1.027
        face.append((x,y,z,.035))
eyes=dots('HERO_pingo_eyes_routing',face,[route],parent=rig)

def text(name, body, x, z, size, mat, align='LEFT'):
    curve=bpy.data.curves.new(name+'_text','FONT')
    curve.body=body;curve.size=size;curve.align_x=align
    curve.extrude=.002;curve.bevel_depth=.0005
    obj=bpy.data.objects.new(name,curve)
    scene.collection.objects.link(obj)
    obj.location=(x,-1.55,z)
    obj.rotation_euler=(math.pi/2,0,0)
    curve.materials.append(mat)
    return obj

text('TXT_title','Pingo',-1.3,1.17,.90,ink)
text('TXT_subtitle','A Claude Code mod powered by Jev.',-1.24,.67,.26,dim)
text('TXT_principle','Jev suggests. Claude decides.',-1.24,.12,.31,ink)
text('TXT_mood_routing','ROUTING',-3.3,-1.57,.22,route,'CENTER')
text('TXT_legend','Typed decisions. Visible activity.',-1.24,-.41,.20,dim)
xs=[-1.05,.95,2.95,4.95]
labels=['CLAUDE','JEV','CLAUDE','TOOLS']
colors=[claude,route,claude,ink]
for index,(x,label,mat) in enumerate(zip(xs,labels,colors)):
    cloud=fibonacci(72,.23)
    dots('FLOW_node_'+str(index),[(x+px,py,-1.2+pz,.022) for px,py,pz in cloud],[mat])
    text('FLOW_label_'+str(index),label,x,-1.76,.18,mat,'CENTER')
for index,caption in enumerate(['context','hint','tool call']):
    a=xs[index]+.34;b=xs[index+1]-.34
    points=[(a+(b-a)*j/19,.1,-1.2,.021) for j in range(20)]
    dots('FLOW_path_'+str(index),points,[dim])
    dots('FLOW_arrow_'+str(index),[(b-.04-k*.065,.1,-1.2+side*k*.036,.023) for side in [-1,1] for k in range(4)],[dim])
    text('FLOW_caption_'+str(index),caption,(a+b)/2,-.89,.16,dim,'CENTER')
text('FLOW_note','Illustration of an accepted hint; Claude chooses the tool and its arguments.',1.95,-2.13,.145,dim,'CENTER')
bpy.ops.object.camera_add(location=(.55,-18,0))
camera=bpy.context.object
camera.name='CAM_main'
camera.rotation_euler=(Vector((.55,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=11.65
scene.camera=camera
bpy.ops.object.light_add(type='SUN',location=(-4,-5,7))
key=bpy.context.object;key.name='LGT_key';key.data.energy=.85
key.rotation_euler=(math.radians(25),math.radians(-18),math.radians(-20))
bpy.ops.object.light_add(type='POINT',location=(2,-7,2))
fill=bpy.context.object;fill.name='LGT_fill';fill.data.energy=90;fill.data.shadow_soft_size=4
assert len(pts)==700 and scene.camera.name=='CAM_main'

scene=bpy.context.scene
rig=bpy.data.objects['RIG_pingo']
mats=bpy.data.materials
moods=['routing','thinking','passthrough','failing','idle','baseline']
colors=[mats['MAT_route'],mats['MAT_ink'],mats['MAT_passthrough'],mats['MAT_failure'],mats['MAT_dim'],mats['MAT_baseline']]
scene.render.fps=12
scene.frame_start=1
scene.frame_end=108

def active(obj, index):
    for frame in [1,19,37,55,73,91,109]:
        obj.scale=(1,1,1) if frame==1+index*18 else (0,0,0)
        obj.keyframe_insert(data_path='scale',frame=frame)
    for layer in obj.animation_data.action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for point in curve.keyframe_points: point.interpolation='CONSTANT'

active(bpy.data.objects['HERO_pingo_eyes_routing'],0)
active(bpy.data.objects['TXT_mood_routing'],0)

for index,mood in enumerate(moods[1:],1):
    label=text('TXT_mood_'+mood,mood.upper(),-3.3,-1.57,.22,colors[index],'CENTER')
    active(label,index)
    if mood=='thinking':
        for side in [-1,1]:
            pivot=bpy.data.objects.new('RIG_spinner_'+str(side),None)
            scene.collection.objects.link(pivot);pivot.parent=rig
            pivot.location=(side*.42,-1.36,.17)
            pts=[(.14*math.cos(.8+5.2*j/17),0,.14*math.sin(.8+5.2*j/17),.034) for j in range(18)]
            dots('HERO_spinner_'+str(side),pts,[colors[index]],parent=pivot)
            active(pivot,index)
            for frame,angle in [(1,0),(109,side*math.pi*18)]:
                pivot.rotation_euler.y=angle
                pivot.keyframe_insert(data_path='rotation_euler',frame=frame)
        ringpts=[(1.68*math.cos(2*math.pi*j/64),1.68*math.sin(2*math.pi*j/64),.20*math.sin(2*math.pi*j/64)-.05,.025) for j in range(64)]
        ring=dots('HERO_thinking_orbit',ringpts,[mats['MAT_ink']],parent=rig)
        active(ring,index)
    else:
        face=[]
        for side in [-1,1]:
            cx=side*.42
            if mood=='passthrough':
                coords=[(cx+dx*.037,.17+dz*.040) for dx in range(-3,4) for dz in range(-5,6) if (dx/3.2)**2+(dz/5.2)**2<1]
            elif mood=='failing':
                coords=[(cx+v*.16,.17+s*v*.16) for s in [-1,1] for v in [-1+j/6 for j in range(13)]]
            elif mood=='idle':
                coords=[(cx-.15+j*.0375,.15) for j in range(9)]
            else:
                coords=[(cx+.16*math.cos(math.pi+.15+2.84*j/12),.22+.16*math.sin(math.pi+.15+2.84*j/12)) for j in range(13)]
            for x,z in coords:
                face.append((x,-math.sqrt(max(0,1.35**2-x*x-z*z))*1.028,z,.031))
        eye=dots('HERO_pingo_eyes_'+mood,face,[colors[index]],parent=rig)
        active(eye,index)

for frame,angle in [(1,-.075),(28,.11),(55,-.075),(82,-.22),(109,-.075)]:
    rig.rotation_euler.z=angle
    rig.keyframe_insert(data_path='rotation_euler',frame=frame)
    rig.scale=(1+.012*math.sin((frame-1)*math.pi/27),)*3
    rig.keyframe_insert(data_path='scale',frame=frame)
body=bpy.data.objects['HERO_pingo_body']
for frame,angle in [(1,0),(109,2*math.pi)]:
    body.rotation_euler.z=angle
    body.keyframe_insert(data_path='rotation_euler',frame=frame)

for index,x in enumerate([-1.05,.95,2.95,4.95]):
    node=bpy.data.objects['FLOW_node_'+str(index)]
    for v in node.data.vertices:
        v.co.x-=x;v.co.z+=1.2
    node.location=(x,0,-1.2)
    for frame,angle in [(1,0),(109,2*math.pi)]:
        node.rotation_euler.z=angle
        node.keyframe_insert(data_path='rotation_euler',frame=frame)

pulse=dots('FLOW_pulse',[(0,0,0,.09)],[mats['MAT_route']])
for frame,x,scale in [(1,-1.05,0),(4,-1.05,1),(23,.95,1),(29,.95,1),(54,2.95,1),(60,2.95,1),(84,4.95,1),(96,4.95,0),(109,-1.05,0)]:
    pulse.location=(x,-.35,-1.2)
    pulse.scale=(scale,)*3
    pulse.keyframe_insert(data_path='location',frame=frame)
    pulse.keyframe_insert(data_path='scale',frame=frame)

for obj in [body,pulse]+[o for o in scene.objects if o.name.startswith('FLOW_node_') or o.name.startswith('RIG_spinner_')]:
    for layer in obj.animation_data.action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for point in curve.keyframe_points: point.interpolation='LINEAR'

scene.render.engine='BLENDER_WORKBENCH'
scene.render.resolution_x=1000
scene.render.resolution_y=400
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=False
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world.color=(.008,.012,.02)
for mat in bpy.data.materials:
    if mat.use_nodes: mat.diffuse_color=mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value

scene.frame_set(1)
assert scene.frame_end==108 and len(moods)==6
result={'moods':moods,'fps':scene.render.fps,'frame_range':[scene.frame_start,scene.frame_end],'objects':len(scene.objects),'body_points':700,'loop_keys':[1,109]}
target=artifacts.file(name='pingo-animation-rest.png',media_type='image/png')
scene.render.image_settings.media_type='IMAGE'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(target.path)
bpy.ops.render.render(write_still=True)
target.publish()
