"""
RewardsHub · Caja de regalo abriéndose (asset 3D del paso 03 "Ellos regresan")
===============================================================================

Caja ámbar con listón café, la tapa saltando y monedas RH + confeti saliendo
de adentro con un brillo cálido. Representa la recompensa desbloqueada.

Genera:
- rh_gift.png   → render horizontal 4:3 con fondo transparente
- rh_gift.glb   → caja, tapa, monedas y confeti, con animación de apertura
- rh_gift.blend → escena para ajustar a mano

Reutiliza rh_coin.py (moneda, materiales, estudio) y rh_phone.py (rounded_box).

Uso:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_gift.py
"""

import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
sys.path.insert(0, HERE)
import rh_coin  # noqa: E402
from rh_phone import duplicate_hierarchy, rounded_box  # noqa: E402

CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    "box_color": "#FFB733",      # color del logo
    "ribbon_color": "#2D2714",   # café oscuro
    "inner_color": "#A8650A",    # interior de la caja
    "confetti": ["#FFB733", "#FFD48A", "#2D2714", "#F5EFE0", "#EBA626"],
    "box_size": 1.3,
    "box_height": 1.0,
    "confetti_count": 46,
    "seed": 11,
    "frames": 72,
    "samples": int(os.environ.get("RH_SAMPLES", 160)),
    "resolution": (1600, 1200),
    "render": True,
    "export_glb": True,
}


def boolean_cut(obj, cutter):
    m = obj.modifiers.new("Cut", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", cutter, "EXACT"
    rh_coin.apply_modifiers(obj)
    bpy.data.objects.remove(cutter, do_unlink=True)


def set_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def build_box(cfg):
    s, h = cfg["box_size"], cfg["box_height"]
    box_mat = rh_coin.material("Gift_Box", cfg["box_color"], 0.42, 0.3)
    rib_mat = rh_coin.material("Gift_Ribbon", cfg["ribbon_color"], 0.38, 0.4)
    inner_mat = rh_coin.material("Gift_Inner", cfg["inner_color"], 0.6)

    # Cuerpo hueco
    body = rounded_box("Gift_Body", s, s, h, 0.08, seg=8, soft=0.025)
    body.location.z = h / 2
    rh_coin.apply_modifiers(body)
    cav = rounded_box("Cavity", s - 0.12, s - 0.12, h, 0.05, seg=8)
    cav.location.z = h / 2 + 0.08
    boolean_cut(body, cav)
    set_mat(body, box_mat)
    body.data.materials.append(inner_mat)
    for p in body.data.polygons:  # caras interiores → material oscuro
        c = p.center
        if abs(c.x) < s / 2 - 0.03 and abs(c.y) < s / 2 - 0.03 and c.z > 0.05:
            p.material_index = 1

    # Listón del cuerpo (dos bandas cruzadas por fuera)
    bands = []
    for i, (w, d) in enumerate(((s + 0.02, 0.2), (0.2, s + 0.02))):
        b = rounded_box(f"Gift_Band_{i}", w, d, h - 0.02, 0.02, seg=4, soft=0.01)
        b.location.z = h / 2
        cut = rounded_box("BandCav", s - 0.1, s - 0.1, h, 0.05, seg=8)
        cut.location.z = h / 2 + 0.08
        boolean_cut(b, cut)
        set_mat(b, rib_mat)
        bands.append(b)

    # Tapa con su listón y moño
    lid_h = 0.26
    lid = rounded_box("Gift_Lid", s + 0.1, s + 0.1, lid_h, 0.1, seg=8, soft=0.03)
    set_mat(lid, box_mat)
    lid_parts = []
    for i, (w, d) in enumerate(((s + 0.12, 0.2), (0.2, s + 0.12))):
        b = rounded_box(f"Gift_LidBand_{i}", w, d, lid_h + 0.02, 0.02, seg=4, soft=0.01)
        set_mat(b, rib_mat)
        b.parent = lid
        lid_parts.append(b)
    for i, ang in enumerate((35, -35)):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.24, minor_radius=0.075,
                                         major_segments=48, minor_segments=16)
        loop = bpy.context.object
        loop.name = f"Gift_Bow_{i}"
        side = 1 if i == 0 else -1
        loop.scale = (1.3, 0.75, 1.0)  # óvalo acostado
        loop.rotation_euler = Euler((math.radians(90), math.radians(-28 * side), math.radians(ang)))
        loop.location = (0.24 * side * math.cos(math.radians(ang)),
                         0.24 * side * math.sin(math.radians(ang)), lid_h / 2 + 0.12)
        rh_coin.smooth(loop, 60)
        set_mat(loop, rib_mat)
        loop.parent = lid
        lid_parts.append(loop)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, segments=32, ring_count=16, location=(0, 0, lid_h / 2 + 0.08))
    knot = bpy.context.object
    knot.name = "Gift_Knot"
    knot.scale = (1, 1, 0.75)
    rh_coin.smooth(knot, 60)
    set_mat(knot, rib_mat)
    knot.parent = lid
    lid_parts.append(knot)
    return body, bands, lid, lid_parts


def build_confetti(cfg, h):
    rnd = random.Random(cfg["seed"])
    mats = [rh_coin.material(f"Confetti_{i}", c, 0.4, 0.2) for i, c in enumerate(cfg["confetti"])]
    pieces = []
    for i in range(cfg["confetti_count"]):
        kind = rnd.random()
        if kind < 0.62:  # tira plana
            bpy.ops.mesh.primitive_cube_add(size=1)
            o = bpy.context.object
            o.scale = (0.11, 0.035, 0.012)
        elif kind < 0.9:  # disco
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.045, depth=0.014)
            o = bpy.context.object
        else:  # espiral corta (torus parcial simulado con torus delgado)
            bpy.ops.mesh.primitive_torus_add(major_radius=0.05, minor_radius=0.012,
                                             major_segments=24, minor_segments=8)
            o = bpy.context.object
        o.name = f"Confetti_{i:02d}"
        # Cono que sale de la boca de la caja
        t = rnd.random()
        ang = rnd.uniform(0, math.tau)
        rad = 0.15 + t * rnd.uniform(0.5, 1.25)
        o.location = (rad * math.cos(ang), rad * math.sin(ang), h + 0.15 + t * 1.5)
        o.rotation_euler = (rnd.uniform(0, math.tau), rnd.uniform(0, math.tau), rnd.uniform(0, math.tau))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rh_coin.smooth(o, 40)
        set_mat(o, mats[i % len(mats)])
        pieces.append(o)
    return pieces


def main(cfg=CONFIG):
    rh_coin.clear_scene()
    h = cfg["box_height"]
    body, bands, lid, lid_parts = build_box(cfg)

    # Tapa abierta: flota arriba y atrás, inclinada
    lid_open = (Vector((0.4, 0.55, h + 1.0)), Euler((math.radians(-30), math.radians(16), math.radians(10))))
    lid_closed = (Vector((0, 0, h + 0.13)), Euler((0, 0, 0)))

    # Monedas saliendo de la caja
    coin, coin_parts = rh_coin.build_coin(rh_coin.CONFIG)
    coins = [coin]
    for i in range(2):
        c, parts = duplicate_hierarchy(coin, f"RH_Coin_{i + 1}")
        coins.append(c)
        coin_parts += parts
    placements = [
        ((-0.05, -0.15, h + 0.65), (68, 10, 15), 0.3),
        ((-0.62, 0.05, h + 1.15), (60, -24, 40), 0.22),
        ((0.55, -0.3, h + 0.4), (75, 18, -8), 0.2),
    ]
    coins_open = []
    for c, (loc, rot, sc) in zip(coins, placements):
        c.scale = (sc, sc, sc)
        coins_open.append((Vector(loc), Euler([math.radians(a) for a in rot])))

    confetti = build_confetti(cfg, h)

    # Luz cálida que sale de adentro
    glow = bpy.data.lights.new("Gift_Glow", "POINT")
    glow.energy, glow.color, glow.shadow_soft_size = 45, rh_coin.hex_rgba("#FFB24A")[:3], 0.4
    glow_obj = bpy.data.objects.new("Gift_Glow", glow)
    glow_obj.location = (0, 0, h - 0.15)
    bpy.context.collection.objects.link(glow_obj)

    root = bpy.data.objects.new("RH_Gift", None)
    bpy.context.collection.objects.link(root)
    animated = [body, *bands, lid, *coins, *confetti, glow_obj]
    for o in animated:
        o.parent = root
        o.location.z -= h + 0.35  # centra el conjunto en el root (la cámara apunta ahí)
    shift = Vector((0, 0, -(h + 0.35)))

    rh_coin.build_studio(rh_coin.CONFIG, root)
    scene = bpy.context.scene
    scene.cycles.samples = cfg["samples"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]
    root.rotation_euler = (0, 0, math.radians(-32))
    scene.camera.location = (0.0, -9.0, 2.5)

    # Animación: cerrado (frame 1) → abierto (frame final)
    f = cfg["frames"]
    scene.frame_start, scene.frame_end = 1, f
    lid.location, lid.rotation_euler = lid_closed[0] + shift, lid_closed[1]
    lid.keyframe_insert("location", frame=1)
    lid.keyframe_insert("rotation_euler", frame=1)
    for c in coins:
        c.location, c.rotation_euler = Vector((0, 0, h * 0.4)) + shift, Euler((math.radians(90), 0, 0))
        c.keyframe_insert("location", frame=1)
        c.keyframe_insert("rotation_euler", frame=1)
    confetti_open = [o.location.copy() for o in confetti]
    for o in confetti:
        o.location = Vector((0, 0, h * 0.6)) + shift
        o.scale = (0.01, 0.01, 0.01)
        o.keyframe_insert("location", frame=1)
        o.keyframe_insert("scale", frame=1)

    lid.location, lid.rotation_euler = lid_open[0] + shift, lid_open[1]
    lid.keyframe_insert("location", frame=f)
    lid.keyframe_insert("rotation_euler", frame=f)
    for c, (loc, rot) in zip(coins, coins_open):
        c.location, c.rotation_euler = loc + shift, rot
        c.keyframe_insert("location", frame=f)
        c.keyframe_insert("rotation_euler", frame=f)
    for o, loc in zip(confetti, confetti_open):
        o.location, o.scale = loc, (1, 1, 1)
        o.keyframe_insert("location", frame=f)
        o.keyframe_insert("scale", frame=f)
    scene.frame_set(f)  # el render muestra la caja abierta

    os.makedirs(cfg["out_dir"], exist_ok=True)
    out = lambda name: os.path.join(cfg["out_dir"], name)  # noqa: E731
    if cfg["render"]:
        scene.render.filepath = out("rh_gift.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_gift.png')}")

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in (root, body, *bands, lid, *lid_parts, *coins, *coin_parts, *confetti):
            o.select_set(True)
        kwargs = dict(
            filepath=out("rh_gift.glb"), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=True,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {out('rh_gift.glb')} ({os.path.getsize(out('rh_gift.glb')) / 1024:.0f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=out("rh_gift.blend"))
    print(f"[RH] Escena → {out('rh_gift.blend')}")


if __name__ == "__main__":
    main()
