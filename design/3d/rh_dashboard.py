"""
RewardsHub · Dashboard isométrico flotante (asset 3D de "Funciones")
====================================================================

Panel crema en vista isométrica con barra lateral, KPIs, gráfica de barras
3D en ámbar, una dona de canjes y tarjetas flotando encima (notificación de
puntos, cliente frecuente y una moneda RH). Pensado para el fondo oscuro de
la sección: en la web el panel se inclina con el scroll.

Genera:
- rh_dashboard.png   → render 4:3 con fondo transparente
- rh_dashboard.glb   → con animación (barras creciendo + tarjetas flotando)
- rh_dashboard.blend → escena para ajustar a mano

Uso:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_dashboard.py
"""

import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
sys.path.insert(0, HERE)
import rh_coin  # noqa: E402
from rh_phone import rounded_box  # noqa: E402

CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    "panel": "#EDE3C8",
    "card": "#FAF6EC",
    "ink": "#2D2714",
    "line": "#D9C99C",
    "amber": "#FFB733",
    "amber_deep": "#EBA626",
    "amber_light": "#FFD48A",
    "bars": [0.35, 0.55, 0.42, 0.7, 0.62, 0.9, 1.0],
    "frames": 90,
    "samples": int(os.environ.get("RH_SAMPLES", 160)),
    "resolution": (1600, 1200),
    "render": True,
    "export_glb": True,
}

PARTS = []


def slab(name, w, d, h, r, x, y, z, mat, soft=0.012, parent=None):
    """Bloque redondeado de w×d (planta) y alto h, apoyado en z."""
    o = rounded_box(name, w, d, h, min(r, w / 2 - 1e-3, d / 2 - 1e-3), seg=6, soft=soft)
    o.location = (x, y, z + h / 2)
    o.data.materials.clear()
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
    PARTS.append(o)
    return o


def text_lines(prefix, x, y, z, widths, mat, gap=0.07, h=0.035, parent=None):
    for i, w in enumerate(widths):
        slab(f"{prefix}_{i}", w, h, 0.012, h / 2, x + w / 2, y - i * gap, z, mat, soft=0, parent=parent)


def build(cfg):
    M = {k: rh_coin.material(f"Dash_{k}", cfg[k], r, c) for k, r, c in (
        ("panel", 0.55, 0.2), ("card", 0.5, 0.25), ("ink", 0.45, 0.3), ("line", 0.6, 0),
        ("amber", 0.4, 0.35), ("amber_deep", 0.4, 0.35), ("amber_light", 0.45, 0.2))}

    W, D = 3.2, 2.2
    top = 0.12
    slab("Dash_Panel", W, D, top, 0.14, 0, 0, 0, M["panel"], soft=0.03)

    # Barra lateral
    sx = -W / 2 + 0.32
    slab("Dash_Sidebar", 0.46, D - 0.16, 0.03, 0.08, sx, 0, top, M["ink"])
    slab("Dash_Logo", 0.2, 0.2, 0.03, 0.06, sx, D / 2 - 0.25, top + 0.03, M["amber"])
    for i in range(5):
        slab(f"Dash_Nav_{i}", 0.22, 0.05, 0.015, 0.025, sx, D / 2 - 0.6 - i * 0.2, top + 0.03,
             M["amber"] if i == 0 else M["line"], soft=0)

    # Área de contenido
    cx0 = sx + 0.33  # borde izquierdo del contenido
    cw = W / 2 - 0.1 - cx0
    text_lines("Dash_Title", cx0, D / 2 - 0.16, top, [0.7, 0.42], M["ink"], gap=0.08, h=0.045)

    # KPIs (3 tarjetas)
    kw = (cw - 0.2) / 3
    ky = D / 2 - 0.62
    for i in range(3):
        kx = cx0 + kw / 2 + i * (kw + 0.1)
        slab(f"Dash_KPI_{i}", kw, 0.42, 0.06, 0.06, kx, ky, top, M["card"])
        text_lines(f"Dash_KPI_{i}_t", kx - kw / 2 + 0.1, ky + 0.11, top + 0.06, [kw * 0.45], M["line"])
        slab(f"Dash_KPI_{i}_v", kw * 0.55, 0.09, 0.03, 0.04, kx - kw / 2 + 0.1 + kw * 0.275, ky - 0.05,
             top + 0.06, M["ink"])
        slab(f"Dash_KPI_{i}_up", 0.09, 0.09, 0.03, 0.045, kx + kw / 2 - 0.16, ky - 0.05, top + 0.06,
             M["amber"])

    # Tarjeta de gráfica de barras
    gw, gd = cw * 0.62, 1.1
    gx, gy = cx0 + gw / 2, -D / 2 + 0.1 + gd / 2
    slab("Dash_ChartCard", gw, gd, 0.06, 0.08, gx, gy, top, M["card"])
    text_lines("Dash_Chart_t", gx - gw / 2 + 0.12, gy + gd / 2 - 0.12, top + 0.06, [0.45], M["line"])
    bars = []
    n = len(cfg["bars"])
    bw = (gw - 0.3) / n * 0.72
    for i, v in enumerate(cfg["bars"]):
        bx = gx - gw / 2 + 0.15 + (i + 0.5) * (gw - 0.3) / n
        hgt = 0.1 + v * 0.75
        mat = M["amber"] if i == n - 1 else (M["amber_light"] if i % 2 else M["amber_deep"])
        b = slab(f"Dash_Bar_{i}", bw, bw, hgt, 0.03, bx, gy - 0.12, top + 0.06, mat, soft=0.01)
        bars.append((b, hgt))

    # Tarjeta de dona (canjes)
    dw = cw - gw - 0.1
    dx = cx0 + gw + 0.1 + dw / 2
    slab("Dash_DonutCard", dw, gd, 0.06, 0.08, dx, gy, top, M["card"])
    bpy.ops.mesh.primitive_torus_add(major_radius=0.27, minor_radius=0.075, major_segments=96,
                                     minor_segments=24, location=(dx, gy + 0.08, top + 0.06 + 0.075))
    donut = bpy.context.object
    donut.name = "Dash_Donut"
    donut.scale.z = 0.8
    rh_coin.smooth(donut, 60)
    donut.data.materials.append(M["ink"])
    donut.data.materials.append(M["amber"])
    for p in donut.data.polygons:  # 68 % del aro en ámbar
        a = math.atan2(p.center.y, p.center.x) % math.tau
        if a < math.tau * 0.68:
            p.material_index = 1
    PARTS.append(donut)
    text_lines("Dash_Donut_t", dx - dw / 2 + 0.12, gy - gd / 2 + 0.2, top + 0.06, [dw * 0.6, dw * 0.35],
               M["line"])

    # Tarjetas flotantes
    floaters = []
    n1 = slab("Dash_Float_Points", 1.05, 0.36, 0.07, 0.12, 0.95, D / 2 - 0.05, top + 0.6, M["card"], soft=0.02)
    slab("Dash_Float_Points_dot", 0.2, 0.2, 0.03, 0.1, -0.33, 0, 0.035, M["amber"], parent=n1)
    text_lines("Dash_Float_Points_t", -0.16, 0.06, 0.035, [0.55, 0.32], M["ink"], gap=0.1, h=0.045, parent=n1)
    floaters.append(n1)

    n2 = slab("Dash_Float_Client", 0.8, 0.5, 0.07, 0.1, W / 2 - 0.05, -D / 2 - 0.4, top + 0.3, M["ink"], soft=0.02)
    slab("Dash_Float_Client_av", 0.22, 0.22, 0.03, 0.11, -0.22, 0.06, 0.035, M["amber_light"], parent=n2)
    text_lines("Dash_Float_Client_t", 0.0, 0.11, 0.035, [0.3, 0.2], M["line"], gap=0.09, h=0.04, parent=n2)
    slab("Dash_Float_Client_bar", 0.6, 0.05, 0.02, 0.025, 0, -0.16, 0.035, M["amber"], soft=0, parent=n2)
    floaters.append(n2)

    coin, coin_parts = rh_coin.build_coin(rh_coin.CONFIG)
    coin.scale = (0.28, 0.28, 0.28)
    coin.location = (-0.55, -D / 2 + 0.15, top + 1.05)
    coin.rotation_euler = (math.radians(70), math.radians(8), math.radians(40))
    floaters.append(coin)
    return bars, floaters, coin_parts


def main(cfg=CONFIG):
    rh_coin.clear_scene()
    PARTS.clear()
    bars, floaters, coin_parts = build(cfg)

    root = bpy.data.objects.new("RH_Dashboard", None)
    bpy.context.collection.objects.link(root)
    for o in PARTS + floaters:
        if o.parent is None:
            o.parent = root

    rh_coin.build_studio(rh_coin.CONFIG, root)
    scene = bpy.context.scene
    scene.cycles.samples = cfg["samples"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]
    root.rotation_euler = (0, 0, math.radians(-38))
    root.location = (0, 0, -0.3)
    cam = scene.camera
    cam.data.type = "ORTHO"  # isométrico de verdad: sin fuga
    cam.data.ortho_scale = 4.15
    scene.view_settings.exposure = -0.75
    cam.location = (0, -8, 6.2)

    # Animación: barras crecen, tarjetas flotan (loop)
    f = cfg["frames"]
    scene.frame_start, scene.frame_end = 1, f
    for b, hgt in bars:
        z_full = b.location.z
        base = z_full - hgt / 2
        b.scale.z, b.location.z = 0.05, base + hgt * 0.025
        b.keyframe_insert("scale", frame=1)
        b.keyframe_insert("location", frame=1)
        b.scale.z, b.location.z = 1, z_full
        b.keyframe_insert("scale", frame=int(f * 0.6))
        b.keyframe_insert("location", frame=int(f * 0.6))
    for i, o in enumerate(floaters):
        z0 = o.location.z
        for fr, dz in ((1, 0), (f // 2, 0.08 if i % 2 == 0 else -0.08), (f, 0)):
            o.location.z = z0 + dz
            o.keyframe_insert("location", frame=fr)
        o.location.z = z0
    scene.frame_set(f)

    os.makedirs(cfg["out_dir"], exist_ok=True)
    out = lambda name: os.path.join(cfg["out_dir"], name)  # noqa: E731
    if cfg["render"]:
        scene.render.filepath = out("rh_dashboard.png")
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {out('rh_dashboard.png')}")

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in (root, *PARTS, *floaters, *coin_parts):
            o.select_set(True)
        kwargs = dict(
            filepath=out("rh_dashboard.glb"), export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=True,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {out('rh_dashboard.glb')} ({os.path.getsize(out('rh_dashboard.glb')) / 1024:.0f} KB)")

    bpy.ops.wm.save_as_mainfile(filepath=out("rh_dashboard.blend"))
    print(f"[RH] Escena → {out('rh_dashboard.blend')}")


if __name__ == "__main__":
    main()
