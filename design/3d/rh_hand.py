"""
RewardsHub · Mano sosteniendo el teléfono con QR + monedas (asset 3D de "Para clientes")
========================================================================================

Mano estilizada (look de plastilina, hecha con metaballs) sosteniendo el
teléfono RH en tono oscuro para que contraste con el fondo ámbar de la
sección, con monedas flotando alrededor.

Genera:
- rh_hand.png   → render con fondo transparente
- rh_hand.glb   → mano + teléfono + monedas, con animación de flotado
- rh_hand.blend → escena para ajustar a mano

Reutiliza rh_phone.py (teléfono) y rh_coin.py (moneda, estudio).

Uso:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_hand.py
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
sys.path.insert(0, HERE)
import rh_coin  # noqa: E402
import rh_phone  # noqa: E402

CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    "skin": "#D99A6C",
    "sleeve": "#2D2714",
    "cuff": "#FFB733",
    "phone_body": "#1E1A0F",
    "frames": 120,
    "samples": int(os.environ.get("RH_SAMPLES", 160)),
    "resolution": (1600, 1400),
    "render": True,
    "export_glb": True,
}


def build_hand(cfg):
    """Mano en coordenadas del teléfono: X ancho, Y alto, Z hacia la pantalla."""
    mb = bpy.data.metaballs.new("RH_Hand")
    mb.resolution, mb.render_resolution, mb.threshold = 0.025, 0.018, 0.6
    obj = bpy.data.objects.new("RH_Hand", mb)
    bpy.context.collection.objects.link(obj)

    def ball(co, r, stiff=2.0, kind="BALL", size=None, rot=None):
        e = mb.elements.new(type=kind)
        e.co, e.radius, e.stiffness = co, r, stiff
        if size:
            e.size_x, e.size_y, e.size_z = size
        if rot:
            e.rotation = rot
        return e

    def capsule(p1, p2, r, stiff=2.4):
        p1, p2 = Vector(p1), Vector(p2)
        d = p2 - p1
        rot = Vector((1, 0, 0)).rotation_difference(d.normalized())
        ball((p1 + p2) / 2, r, stiff, "CAPSULE", (d.length / 2, 0, 0), rot)

    # Palma detrás de la mitad baja del teléfono
    ball((0.06, -0.5, -0.2), 0.36, 2.0, "ELLIPSOID", (0.95, 1.2, 0.5))
    # Muñeca / antebrazo saliendo abajo a la derecha
    capsule((0.12, -0.85, -0.22), (0.31, -1.52, -0.28), 0.36, 2.0)

    # Cuatro dedos rodeando el canto izquierdo y asomando al frente
    for i, y in enumerate((-0.12, -0.31, -0.5, -0.68)):
        r = 0.105 if i else 0.098
        reach = (0.0, 0.02, 0.0, -0.03)[i]
        base = (-0.16, y - 0.04, -0.17)
        edge = (-0.47 - reach * 0.3, y, -0.02)
        tip = (-0.38 + reach, y + 0.04, 0.085)
        capsule(base, edge, r)
        capsule(edge, tip, r * 0.92)

    # Pulgar por el canto derecho, apoyado al frente
    capsule((0.22, -0.72, -0.12), (0.46, -0.5, -0.01), 0.12)
    capsule((0.46, -0.5, -0.01), (0.36, -0.3, 0.085), 0.108)

    rh_coin.set_active(obj)
    bpy.ops.object.convert(target="MESH")
    hand = bpy.context.object
    hand.name = "RH_Hand"
    sub = hand.modifiers.new("Smooth", "SMOOTH")
    sub.factor, sub.iterations = 0.6, 6
    rh_coin.apply_modifiers(hand)
    bpy.ops.object.shade_smooth()
    hand.data.materials.clear()
    hand.data.materials.append(rh_coin.material("RH_Skin", cfg["skin"], 0.55, 0.1))

    # Manga con puño ámbar
    def cyl(name, r, depth, p1, p2, mat, soft=0.03):
        p1, p2 = Vector(p1), Vector(p2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=r, depth=depth, location=(p1 + p2) / 2)
        c = bpy.context.object
        c.name = name
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((p2 - p1).normalized())
        bev = c.modifiers.new("Soft", "BEVEL")
        bev.width, bev.segments = soft, 6
        rh_coin.apply_modifiers(c)
        rh_coin.smooth(c, 40)
        c.data.materials.append(mat)
        return c

    axis_a, axis_b = Vector((0.12, -0.85, -0.22)), Vector((0.42, -1.9, -0.32))
    d = (axis_b - axis_a).normalized()
    cuff_a = axis_a + d * 0.5
    cuff = cyl("RH_Cuff", 0.3, 0.14, cuff_a, cuff_a + d * 0.14,
               rh_coin.material("RH_Cuff", cfg["cuff"], 0.45, 0.2))
    # Manga corta y redondeada: la mano "flota" y funciona en cualquier tamaño de slot
    sleeve = cyl("RH_Sleeve", 0.34, 0.5, cuff_a + d * 0.14, cuff_a + d * 0.64,
                 rh_coin.material("RH_Sleeve", cfg["sleeve"], 0.6, 0.1), soft=0.12)
    return hand, [cuff, sleeve]


def main(cfg=CONFIG):
    rh_coin.clear_scene()
    phone_cfg = dict(rh_phone.CONFIG, body_color=cfg["phone_body"])
    phone, phone_parts = rh_phone.build_phone(phone_cfg)
    hand, extras = build_hand(cfg)

    group = bpy.data.objects.new("RH_HandPhone", None)  # mano + teléfono (se mueven juntos)
    bpy.context.collection.objects.link(group)
    for o in (phone, hand, *extras):
        o.parent = group
    group.location = (0, 0.6, 0)

    coin, coin_parts = rh_coin.build_coin(rh_coin.CONFIG)
    coins = [coin]
    for i in range(2):
        c, parts = rh_phone.duplicate_hierarchy(coin, f"RH_Coin_{i + 1}")
        coins.append(c)
        coin_parts += parts
    # Posiciones en el espacio del root (X ancho, Y alto, Z hacia cámara)
    placements = [
        ((0.78, 1.2, 0.25), (8, -24, 18), 0.26),
        ((-0.78, 0.8, 0.35), (-6, 28, -12), 0.21),
        ((0.92, 0.3, -0.1), (14, -40, 30), 0.17),
    ]
    for c, (loc, rot, sc) in zip(coins, placements):
        c.location, c.scale = loc, (sc, sc, sc)
        c.rotation_euler = Euler([math.radians(a) for a in rot])

    root = bpy.data.objects.new("RH_Hand_Root", None)
    bpy.context.collection.objects.link(root)
    group.parent = root
    for c in coins:
        c.parent = root

    rh_coin.build_studio(rh_coin.CONFIG, root)
    scene = bpy.context.scene
    scene.cycles.samples = cfg["samples"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]
    # Pantalla (+Z local) hacia la cámara, con giro 3/4
    root.rotation_euler = (math.radians(84), math.radians(-6), math.radians(-20))
    scene.camera.location = (0.0, -8.0, 0.75)

    # Animación: flotado suave en loop
    f = cfg["frames"]
    scene.frame_start, scene.frame_end = 1, f
    movers = [(group, 0.05)] + [(c, 0.09 * (1 if i % 2 else -1)) for i, c in enumerate(coins)]
    for o, amp in movers:
        y0 = o.location.y
        for fr, k in ((1, 0), (f // 2, 1), (f, 0)):
            o.location.y = y0 + amp * k
            o.keyframe_insert("location", frame=fr)
        o.location.y = y0
    scene.frame_set(1)

    os.makedirs(cfg["out_dir"], exist_ok=True)
    out = lambda name: os.path.join(cfg["out_dir"], name)  # noqa: E731
    if cfg["render"]:
        scene.render.filepath = out("rh_hand.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_hand.png')}")

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in (root, group, phone, *phone_parts, hand, *extras, *coins, *coin_parts):
            o.select_set(True)
        kwargs = dict(
            filepath=out("rh_hand.glb"), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=True,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {out('rh_hand.glb')} ({os.path.getsize(out('rh_hand.glb')) / 1024:.0f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=out("rh_hand.blend"))
    print(f"[RH] Escena → {out('rh_hand.blend')}")


if __name__ == "__main__":
    main()
