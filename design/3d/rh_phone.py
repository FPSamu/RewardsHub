"""
RewardsHub · Teléfono con QR (asset 3D para la landing)
=======================================================

Teléfono redondeado estilo clay con pantalla emisiva que muestra la app:
logo arriba, código QR con la R al centro y botón ámbar abajo.

Genera dos renders y un GLB:
- rh_phone.png      → teléfono solo (paso 02 "Escanea y suma")
- rh_hero.png       → teléfono + monedas RH flotando (hero)
- rh_phone.glb      → solo el teléfono; en la web las monedas orbitan con código
- rh_phone.blend    → escena completa para ajustar a mano

Reutiliza la moneda de rh_coin.py (debe estar en la misma carpeta).

Uso:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_phone.py
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
sys.path.insert(0, HERE)
import rh_coin  # noqa: E402  (moneda, materiales y helpers compartidos)

CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    # Colores (sRGB)
    "body_color": "#F5EFE0",     # crema
    "accent_color": "#FFB733",   # ámbar marca (botones, logo, CTA)
    "screen_color": "#FFFAF0",   # pantalla
    "ink_color": "#13110A",      # QR / notch
    # Geometría
    "width": 0.80, "height": 1.62, "depth": 0.12,
    "corner": 0.15,              # radio de las esquinas
    "bezel": 0.045,              # marco alrededor de la pantalla
    # Render
    "samples": int(os.environ.get("RH_SAMPLES", 160)),  # RH_SAMPLES=32 para previsualizar rápido
    "resolution": (1600, 1600),
    "render": True,
    "export_glb": True,
}


# --------------------------------------------------------------- helpers
def rounded_box(name, w, h, d, r, seg=12, soft=0.0):
    """Caja con esquinas verticales redondeadas (radio r) y canto suave opcional."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, h, d), verts=bm.verts)
    vertical = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().z) > 0.99]
    bmesh.ops.bevel(bm, geom=vertical, offset=r, segments=seg, affect="EDGES", profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    if soft > 0:
        m = obj.modifiers.new("Soft", "BEVEL")
        m.width, m.segments, m.limit_method = soft, 4, "ANGLE"
        m.angle_limit = math.radians(50)
        m.harden_normals = True
        rh_coin.apply_modifiers(obj)
    rh_coin.smooth(obj, 40)
    return obj


def emissive(name, color, strength=1.0, roughness=0.35):
    mat = rh_coin.material(name, color, roughness)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    for key in ("Emission Color", "Emission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = rh_coin.hex_rgba(color)
            break
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def qr_pattern(n=25, seed=7):
    """Matriz tipo QR (decorativa) con los tres patrones de esquina y hueco central."""
    rnd = random.Random(seed)
    grid = [[rnd.random() < 0.48 for _ in range(n)] for _ in range(n)]

    def finder(ox, oy):
        for y in range(-1, 8):
            for x in range(-1, 8):
                gx, gy = ox + x, oy + y
                if 0 <= gx < n and 0 <= gy < n:
                    ring = max(abs(x - 3), abs(y - 3))
                    grid[gy][gx] = ring in (0, 1, 3) if 0 <= x < 7 and 0 <= y < 7 else False

    finder(0, 0), finder(n - 7, 0), finder(0, n - 7)
    c, hole = n // 2, 4  # hueco para la R al centro
    for y in range(c - hole, c + hole + 1):
        for x in range(c - hole, c + hole + 1):
            grid[y][x] = False
    return grid


def build_qr(name, size, mat, z, raise_=0.004):
    grid = qr_pattern()
    n = len(grid)
    cell = size / n
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    for y, row in enumerate(grid):
        for x, on in enumerate(row):
            if not on:
                continue
            geom = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(cell * 0.94, cell * 0.94, raise_), verts=geom["verts"])
            bmesh.ops.translate(
                bm, verts=geom["verts"],
                vec=((x + 0.5) * cell - size / 2, size / 2 - (y + 0.5) * cell, z + raise_ / 2),
            )
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    return obj


def build_phone(cfg):
    W, H, D, R, B = cfg["width"], cfg["height"], cfg["depth"], cfg["corner"], cfg["bezel"]
    m_body = rh_coin.material("RH_Phone_Body", cfg["body_color"], 0.5, 0.2)
    m_accent = rh_coin.material("RH_Phone_Accent", cfg["accent_color"], 0.42, 0.25)
    m_screen = emissive("RH_Phone_Screen", cfg["screen_color"], 0.55, 0.25)
    m_ink = rh_coin.material("RH_Phone_Ink", cfg["ink_color"], 0.45)
    m_line = rh_coin.material("RH_Phone_Line", "#E4D9C2", 0.5)

    parts = []
    body = rounded_box("RH_Phone_Body", W, H, D, R, soft=0.035)
    body.data.materials.append(m_body)
    parts.append(body)

    front = D / 2
    sw, sh = W - 2 * B, H - 2 * B
    screen = rounded_box("RH_Phone_Screen", sw, sh, 0.006, R - B * 0.7)
    screen.location.z = front + 0.002
    screen.data.materials.append(m_screen)
    parts.append(screen)
    sz = front + 0.006

    notch = rounded_box("RH_Phone_Notch", sw * 0.30, 0.055, 0.004, 0.027)
    notch.location = (0, sh / 2 - 0.07, sz)
    notch.data.materials.append(m_ink)
    parts.append(notch)

    # Encabezado: R de marca + líneas de texto
    cfg_logo = dict(rh_coin.CONFIG, logo_height=0.09, logo_extrude=0.006, logo_bevel=0.0015)
    head = rh_coin.build_logo_curve("RH_Phone_HeaderLogo", cfg_logo)
    head.location = (-sw / 2 + 0.11, sh / 2 - 0.20, sz + 0.003)
    head.data.materials.append(m_accent)
    parts.append(head)
    for i, (lw, y) in enumerate(((0.26, 0.185), (0.18, 0.225))):
        ln = rounded_box(f"RH_Phone_Text{i}", lw, 0.022, 0.003, 0.011)
        ln.location = (-sw / 2 + 0.19 + lw / 2, sh / 2 - y, sz)
        ln.data.materials.append(m_line if i else m_ink)
        parts.append(ln)

    # Tarjeta del QR
    qs = sw * 0.78
    card = rounded_box("RH_Phone_QRCard", qs + 0.06, qs + 0.06, 0.004, 0.05)
    card.location = (0, 0.02, sz)
    card.data.materials.append(emissive("RH_Phone_Card", "#FFFFFF", 0.7, 0.4))
    parts.append(card)
    qr = build_qr("RH_Phone_QR", qs, m_ink, sz + 0.002)
    qr.location.y = 0.02
    parts.append(qr)
    center = rh_coin.build_logo_curve(
        "RH_Phone_QRLogo", dict(rh_coin.CONFIG, logo_height=qs * 0.24, logo_extrude=0.008, logo_bevel=0.002)
    )
    center.location = (0, 0.02, sz + 0.006)
    center.data.materials.append(m_accent)
    parts.append(center)

    # Texto bajo el QR + botón ámbar
    sub = rounded_box("RH_Phone_Caption", sw * 0.46, 0.022, 0.003, 0.011)
    sub.location = (0, 0.02 - qs / 2 - 0.09, sz)
    sub.data.materials.append(m_line)
    parts.append(sub)
    cta = rounded_box("RH_Phone_CTA", sw * 0.78, 0.11, 0.012, 0.055, soft=0.004)
    cta.location = (0, -sh / 2 + 0.17, sz + 0.004)
    cta.data.materials.append(m_accent)
    parts.append(cta)

    # Botones laterales
    for i, (y, hgt) in enumerate(((0.36, 0.16), (0.12, 0.10), (0.0, 0.10))):
        x = W / 2 + 0.004 if i == 0 else -W / 2 - 0.004
        btn = rounded_box(f"RH_Phone_Button{i}", 0.022, hgt, D * 0.42, 0.01)
        btn.location = (x, y if i == 0 else y + 0.28, 0)
        btn.data.materials.append(m_accent)
        parts.append(btn)

    for o in parts:
        rh_coin.smooth(o, 40) if o.type == "MESH" and o.name not in ("RH_Phone_QR",) else None

    root = bpy.data.objects.new("RH_Phone", None)
    bpy.context.collection.objects.link(root)
    for o in parts:
        o.parent = root
    return root, parts


def duplicate_hierarchy(root, name):
    """Copia enlazada (comparte malla) de un objeto con sus hijos."""
    new_root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(new_root)
    copies = []
    for child in root.children:
        c = child.copy()  # comparte datos de malla → el GLB/blend pesa menos
        bpy.context.collection.objects.link(c)
        c.parent = new_root
        copies.append(c)
    return new_root, copies


def frame_camera(cam, target, distance, height):
    cam.location = (target.x, target.y - distance, target.z + height)


def main(cfg=CONFIG):
    rh_coin.clear_scene()
    phone, phone_parts = build_phone(cfg)

    coin_root, coin_parts = rh_coin.build_coin(rh_coin.CONFIG)
    rh_coin.build_studio(rh_coin.CONFIG, phone)  # luces, cámara y render apuntando al teléfono
    scene = bpy.context.scene
    scene.cycles.samples = cfg["samples"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]

    # Pose del teléfono (de 3/4, ligeramente inclinado hacia atrás)
    phone.rotation_euler = (math.radians(80), math.radians(-6), math.radians(-24))
    phone.location = (0, 0, 0)

    # Monedas flotando alrededor (composición hero)
    coins = [coin_root]
    placements = [
        ((-0.78, -0.35, 0.62), (math.radians(70), math.radians(18), math.radians(28)), 0.30),
        ((0.82, -0.25, -0.05), (math.radians(82), math.radians(-30), math.radians(-40)), 0.36),
        ((-0.62, -0.55, -0.72), (math.radians(62), math.radians(12), math.radians(18)), 0.24),
    ]
    for i in range(len(placements) - 1):
        r, _ = duplicate_hierarchy(coin_root, f"RH_Coin_{i + 2}")
        coins.append(r)
    for c, (loc, rot, s) in zip(coins, placements):
        c.location, c.rotation_euler, c.scale = loc, rot, (s, s, s)

    cam = scene.camera
    cam.location = (0.0, -5.6, 0.75)

    os.makedirs(cfg["out_dir"], exist_ok=True)
    out = lambda n: os.path.join(cfg["out_dir"], n)  # noqa: E731

    if cfg["render"]:
        scene.render.filepath = out("rh_hero.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_hero.png')}")

        for c in coins:
            for o in [c, *c.children]:
                o.hide_render = True
        cam.location = (0.0, -4.7, 0.6)
        scene.render.filepath = out("rh_phone.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_phone.png')}")
        for c in coins:
            for o in [c, *c.children]:
                o.hide_render = False

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in [phone, *phone_parts]:
            o.select_set(True)
        kwargs = dict(
            filepath=out("rh_phone.glb"), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=False,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {out('rh_phone.glb')} ({os.path.getsize(out('rh_phone.glb')) / 1024:.0f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=out("rh_phone.blend"))
    print(f"[RH] Escena → {out('rh_phone.blend')}")


if __name__ == "__main__":
    main()
