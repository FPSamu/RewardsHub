"""
RewardsHub · Engranes + moneda (asset 3D del paso 01 "Configura tus recompensas")
=================================================================================

Un engrane grande (café oscuro) con la moneda RH encajada al centro y un
engrane chico (ámbar) que embona con él. Representa "configurar" el sistema
de puntos. Los dientes embonan de verdad, así que en la web se pueden girar
con el scroll sin que se atraviesen.

Genera:
- rh_gear.png   → render horizontal 4:3 con fondo transparente
- rh_gear.glb   → engranes + moneda, con animación de giro sincronizada
- rh_gear.blend → escena para ajustar a mano

Reutiliza la moneda de rh_coin.py (misma carpeta).

Uso:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_gear.py
"""

import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
sys.path.insert(0, HERE)
import rh_coin  # noqa: E402

CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    "big_color": "#2D2714",      # café oscuro (neutral 800 del front)
    "small_color": "#EBA626",    # ámbar profundo (primario del front)
    "module": 0.12,              # tamaño de diente (igual en ambos para que embonen)
    "big_teeth": 16,
    "small_teeth": 9,
    "thickness": 0.22,
    "mesh_angle_steps": -2,      # posición del engrane chico (en dientes del grande)
    "coin_pop": 0.16,            # la moneda sale un poco hacia el frente (sugiere ensamble)
    "frames": 240,               # una vuelta del engrane grande
    "samples": int(os.environ.get("RH_SAMPLES", 160)),
    "resolution": (1600, 1200),
    "render": True,
    "export_glb": True,
}


def gear_profile(teeth, module):
    """Contorno 2D de un engrane con dientes trapezoidales suaves."""
    pitch = module * teeth / 2
    tip, root = pitch + 0.95 * module, pitch - 1.25 * module
    step = math.tau / teeth
    pts = []
    for i in range(teeth):
        a = i * step  # centro del diente en el ángulo a
        for frac, r in ((-0.50, root), (-0.27, root), (-0.15, tip), (0.15, tip), (0.27, root)):
            ang = a + frac * step
            pts.append((r * math.cos(ang), r * math.sin(ang)))
    return pts, pitch, root


def build_gear(name, teeth, module, depth, color, hole_r, cutouts=0):
    pts, pitch, root = gear_profile(teeth, module)
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)], vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    def cut(radius, x=0.0, y=0.0):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth * 3, location=(x, y, 0))
        c = bpy.context.object
        m = obj.modifiers.new("Cut", "BOOLEAN")
        m.operation, m.object, m.solver = "DIFFERENCE", c, "EXACT"
        rh_coin.apply_modifiers(obj)
        bpy.data.objects.remove(c, do_unlink=True)

    cut(hole_r)
    if cutouts:  # agujeros de aligeramiento (look de juguete)
        ring = (hole_r + root) / 2
        cr = (root - hole_r) * 0.30
        for i in range(cutouts):
            a = math.tau * i / cutouts + math.pi / cutouts
            cut(cr, ring * math.cos(a), ring * math.sin(a))

    bev = obj.modifiers.new("Soft", "BEVEL")
    bev.width, bev.segments, bev.limit_method = 0.022, 4, "ANGLE"
    bev.angle_limit = math.radians(35)
    bev.harden_normals = True
    rh_coin.apply_modifiers(obj)
    rh_coin.smooth(obj, 35)
    wn = obj.modifiers.new("Normals", "WEIGHTED_NORMAL")
    wn.keep_sharp = True
    rh_coin.apply_modifiers(obj)
    obj.data.materials.clear()  # el boolean deja un slot vacío
    obj.data.materials.append(rh_coin.material(f"{name}_Mat", color, 0.45, 0.25))
    return obj, pitch


def linear(obj):
    action = obj.animation_data.action
    try:
        curves = action.fcurves
    except AttributeError:
        curves = [c for layer in action.layers for strip in layer.strips
                  for bag in strip.channelbags for c in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def main(cfg=CONFIG):
    rh_coin.clear_scene()
    m, n1, n2, d = cfg["module"], cfg["big_teeth"], cfg["small_teeth"], cfg["thickness"]

    hole = 0.46
    big, p1 = build_gear("RH_Gear_Big", n1, m, d, cfg["big_color"], hole, cutouts=0)
    small, p2 = build_gear("RH_Gear_Small", n2, m, d * 0.9, cfg["small_color"], 0.12, cutouts=0)

    # Colocar el engrane chico embonando: un diente del grande apunta a theta,
    # y el chico pone un hueco en la dirección opuesta.
    theta = cfg["mesh_angle_steps"] * math.tau / n1
    dist = p1 + p2
    small.location = (dist * math.cos(theta), dist * math.sin(theta), -0.02)
    small_phase = theta + math.pi - math.pi / n2
    small.rotation_euler.z = small_phase

    # Moneda encajada al centro del engrane grande
    coin, coin_parts = rh_coin.build_coin(rh_coin.CONFIG)
    s = (hole - 0.03) / rh_coin.CONFIG["radius"]
    coin.scale = (s, s, s * 1.15)
    coin.location.z = cfg["coin_pop"]

    # Centrar el conjunto en el origen (la cámara apunta al root)
    off = small.location.copy() * 0.36
    off.z = 0
    for o in (big, small, coin):
        o.location -= off

    root = bpy.data.objects.new("RH_Gears", None)
    bpy.context.collection.objects.link(root)
    for o in (big, small, coin):
        o.parent = root

    rh_coin.build_studio(rh_coin.CONFIG, root)
    scene = bpy.context.scene
    scene.cycles.samples = cfg["samples"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]
    root.rotation_euler = (math.radians(62), math.radians(-8), math.radians(-18))
    scene.camera.location = (0.0, -7.6, 1.1)

    # Animación: giro sincronizado (relación de dientes)
    f = cfg["frames"]
    scene.frame_start, scene.frame_end = 1, f
    big.keyframe_insert("rotation_euler", frame=1)
    small.keyframe_insert("rotation_euler", frame=1)
    big.rotation_euler.z += math.tau
    small.rotation_euler.z -= math.tau * n1 / n2
    big.keyframe_insert("rotation_euler", frame=f + 1)
    small.keyframe_insert("rotation_euler", frame=f + 1)
    linear(big), linear(small)
    scene.frame_set(1)

    os.makedirs(cfg["out_dir"], exist_ok=True)
    out = lambda name: os.path.join(cfg["out_dir"], name)  # noqa: E731
    if cfg["render"]:
        scene.render.filepath = out("rh_gear.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_gear.png')}")

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in (root, big, small, coin, *coin_parts):
            o.select_set(True)
        kwargs = dict(
            filepath=out("rh_gear.glb"), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=True,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {out('rh_gear.glb')} ({os.path.getsize(out('rh_gear.glb')) / 1024:.0f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=out("rh_gear.blend"))
    print(f"[RH] Escena → {out('rh_gear.blend')}")


if __name__ == "__main__":
    main()
