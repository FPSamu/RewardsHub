"""
RewardsHub · Moneda RH (asset 3D para la landing)
=================================================

Construye la moneda RH desde cero: disco con canto biselado, aro elevado,
cara rebajada y el logo (R con estrella) en relieve en ambas caras.
Deja lista la escena de estudio (luces + cámara), renderiza un PNG con
fondo transparente y exporta un GLB comprimido con Draco para la web.

Uso
---
- Dentro de Blender: pestaña Scripting → abrir este archivo → Run Script.
- Desde la terminal (sin abrir la interfaz):
    /Applications/Blender.app/Contents/MacOS/Blender -b -P design/3d/rh_coin.py

Todo lo ajustable está en CONFIG. Probado en Blender 5.3.
"""

import math
import os

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- CONFIG
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Desktop")
CONFIG = {
    "out_dir": os.path.join(HERE, "out"),
    "name": "rh_coin",
    # Colores de marca (sRGB hex)
    "coin_color": "#FFB733",     # ámbar del logo
    "logo_color": "#FFF6E6",     # crema (como el ícono de la app)
    "rim_color": "#EBA626",      # canto un tono más profundo
    # Geometría (unidades Blender ≈ metros; la moneda mide 2 de diámetro)
    "radius": 1.0,
    "thickness": 0.24,
    "rim_width": 0.11,           # ancho del aro elevado
    "recess_depth": 0.028,       # qué tanto se rebaja la cara
    "logo_height": 1.08,         # alto del logo sobre la cara
    "logo_extrude": 0.034,       # relieve del logo
    "logo_bevel": 0.010,         # suaviza las aristas del logo (look clay)
    "edge_bevel": 0.035,         # bisel del canto exterior
    # Estilo de material
    "roughness": 0.42,
    "coat": 0.25,                # brillo suave tipo plástico
    # Render
    "engine": "CYCLES",
    "samples": 160,
    "resolution": (1600, 1600),
    "render": True,
    "export_glb": True,
    "spin_animation": True,      # giro de 360° en 120 frames (va dentro del GLB)
}

# Trazo del logo (mismo que el componente "Logo / Mark" en Figma).
# Coordenadas del lienzo de 1215 px del ícono de la app.
STAR = [("M", 248, 485), ("L", 442, 485), ("L", 634, 755), ("L", 378, 930), ("L", 456, 641)]
R_SHAPE = [
    ("M", 456, 284), ("L", 762, 284),
    ("C", 860, 300, 952, 380, 952, 490),
    ("C", 952, 600, 880, 645, 852, 660),
    ("L", 968, 930), ("L", 790, 838), ("L", 614, 590), ("L", 690, 590),
    ("C", 760, 590, 815, 570, 815, 500),
    ("C", 815, 420, 740, 395, 690, 395),
    ("L", 506, 395),
]
LOGO_BBOX = (248, 284, 968, 930)  # minx, miny, maxx, maxy


# --------------------------------------------------------------- helpers
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifiers(obj):
    set_active(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def smooth(obj, angle=35):
    set_active(obj)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()


def material(name, color, roughness, coat=0.0, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    for key in ("Coat Weight", "Clearcoat"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = coat
            break
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = 0.35
    return mat


# ------------------------------------------------------------- geometry
def build_logo_curve(name, cfg):
    """Curva bezier rellena a partir de los trazos del logo."""
    minx, miny, maxx, maxy = LOGO_BBOX
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    s = cfg["logo_height"] / (maxy - miny)

    def P(x, y):
        return Vector(((x - cx) * s, -(y - cy) * s, 0.0))

    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = cfg["logo_extrude"] / 2
    curve.bevel_depth = cfg["logo_bevel"]
    curve.bevel_resolution = 4
    curve.resolution_u = 24

    for path in (STAR, R_SHAPE):
        # nodos: (punto, handle_izq, handle_der)
        nodes = []
        for seg in path:
            if seg[0] in ("M", "L"):
                nodes.append([P(seg[1], seg[2]), None, None])
            else:  # cúbica: c1 va en el nodo previo, c2 en el nuevo
                _, x1, y1, x2, y2, x, y = seg
                nodes[-1][2] = P(x1, y1)
                nodes.append([P(x, y), P(x2, y2), None])
        # Si el último nodo coincide con el primero, fusionarlos
        if (nodes[-1][0] - nodes[0][0]).length < 1e-6:
            nodes[0][1] = nodes[-1][1]
            nodes.pop()
        n = len(nodes)
        for i, node in enumerate(nodes):  # handles rectos para tramos lineales
            nxt, prv = nodes[(i + 1) % n], nodes[(i - 1) % n]
            if node[2] is None:
                node[2] = node[0].lerp(nxt[0], 1 / 3)
            if node[1] is None:
                node[1] = node[0].lerp(prv[0], 1 / 3)
        sp = curve.splines.new("BEZIER")
        sp.bezier_points.add(n - 1)
        sp.use_cyclic_u = True
        for bp, (co, hl, hr) in zip(sp.bezier_points, nodes):
            bp.handle_left_type = bp.handle_right_type = "FREE"
            bp.co, bp.handle_left, bp.handle_right = co, hl, hr

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    set_active(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    # Limpieza ligera para que el GLB pese poco
    obj.modifiers.new("Weld", "WELD").merge_threshold = 0.0005
    apply_modifiers(obj)
    return obj


def build_coin(cfg):
    r, t = cfg["radius"], cfg["thickness"]
    mats = {
        "coin": material("RH_Coin_Face", cfg["coin_color"], cfg["roughness"], cfg["coat"]),
        "rim": material("RH_Coin_Rim", cfg["rim_color"], cfg["roughness"] + 0.05, cfg["coat"]),
        "logo": material("RH_Coin_Logo", cfg["logo_color"], 0.5, 0.15),
    }

    # Cuerpo
    bpy.ops.mesh.primitive_cylinder_add(vertices=160, radius=r, depth=t)
    body = bpy.context.object
    body.name = "RH_Coin_Body"
    body.data.materials.append(mats["coin"])
    body.data.materials.append(mats["rim"])

    # Rebaje de ambas caras (deja el aro elevado)
    inner_r = r - cfg["rim_width"]
    for sign in (1, -1):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=160, radius=inner_r, depth=cfg["recess_depth"] * 2,
            location=(0, 0, sign * t / 2),
        )
        cutter = bpy.context.object
        mod = body.modifiers.new(f"Recess{sign}", "BOOLEAN")
        mod.operation, mod.object, mod.solver = "DIFFERENCE", cutter, "EXACT"
        apply_modifiers(body)
        bpy.data.objects.remove(cutter, do_unlink=True)

    # Material del canto: caras cuya normal es horizontal
    for poly in body.data.polygons:
        poly.material_index = 1 if abs(poly.normal.z) < 0.5 else 0

    bev = body.modifiers.new("EdgeBevel", "BEVEL")
    bev.width, bev.segments, bev.limit_method = cfg["edge_bevel"], 5, "ANGLE"
    bev.angle_limit = math.radians(40)
    bev.harden_normals = True
    apply_modifiers(body)
    smooth(body)

    # Logo en relieve en ambas caras
    floor_z = t / 2 - cfg["recess_depth"]
    logos = []
    for sign in (1, -1):
        logo = build_logo_curve(f"RH_Coin_Logo_{'Front' if sign > 0 else 'Back'}", cfg)
        logo.data.materials.append(mats["logo"])
        logo.location.z = sign * (floor_z + cfg["logo_extrude"] / 2)
        if sign < 0:
            logo.rotation_euler.y = math.pi  # se lee correctamente desde atrás
        smooth(logo, 50)
        logos.append(logo)

    # Agrupar bajo un empty para animar/exportar como una sola pieza
    root = bpy.data.objects.new("RH_Coin", None)
    bpy.context.collection.objects.link(root)
    for o in [body, *logos]:
        o.parent = root
    return root, [body, *logos]


# ---------------------------------------------------------------- scene
def build_studio(cfg, root):
    scene = bpy.context.scene

    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = hex_rgba("#2A2418")
    bg.inputs["Strength"].default_value = 0.35
    scene.world = world

    def area(name, loc, energy, size, color):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size, light.shape = energy, size, "DISK"
        light.color = hex_rgba(color)[:3]
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        scene.collection.objects.link(obj)
        track = obj.constraints.new("TRACK_TO")
        track.target, track.track_axis, track.up_axis = root, "TRACK_NEGATIVE_Z", "UP_Y"
        return obj

    area("Key", (3.2, -3.0, 3.4), 420, 3.0, "#FFF1D9")    # luz principal cálida
    area("Fill", (-3.5, -2.0, 1.2), 90, 4.0, "#FFE2B0")    # relleno suave
    area("Rim", (-1.5, 3.5, 2.5), 450, 1.6, "#FFFFFF")     # contraluz para el canto

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 70
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = (0.0, -5.3, 0.9)
    scene.collection.objects.link(cam)
    track = cam.constraints.new("TRACK_TO")
    track.target, track.track_axis, track.up_axis = root, "TRACK_NEGATIVE_Z", "UP_Y"
    scene.camera = cam

    # Pose héroe: la moneda de 3/4 mirando a cámara
    root.rotation_euler = (math.radians(78), math.radians(-14), math.radians(-22))

    scene.render.engine = cfg["engine"]
    scene.render.resolution_x, scene.render.resolution_y = cfg["resolution"]
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # "Standard" respeta los colores de marca tal cual (AgX los desatura)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.35
    if cfg["engine"] == "CYCLES":
        scene.cycles.samples = cfg["samples"]
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception:
            scene.cycles.device = "CPU"


def add_spin(root, frames=120):
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, frames
    base = root.rotation_euler.copy()
    root.keyframe_insert("rotation_euler", frame=1)
    root.rotation_euler.z = base.z + math.tau
    root.keyframe_insert("rotation_euler", frame=frames + 1)
    root.rotation_euler = base
    action = root.animation_data.action
    try:  # interpolación lineal para un giro constante (API clásica y por capas)
        curves = action.fcurves
    except AttributeError:
        curves = [c for layer in action.layers for strip in layer.strips
                  for bag in strip.channelbags for c in bag.fcurves]
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    scene.frame_set(1)


# ---------------------------------------------------------------- output
def export(cfg, root, parts):
    os.makedirs(cfg["out_dir"], exist_ok=True)
    base = os.path.join(cfg["out_dir"], cfg["name"])

    if cfg["render"]:
        bpy.context.scene.render.filepath = base + ".png"
        bpy.ops.render.render(write_still=True)
        print(f"[RH] Render → {base}.png")

    if cfg["export_glb"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in [root, *parts]:
            o.select_set(True)
        kwargs = dict(
            filepath=base + ".glb", export_format="GLB", use_selection=True,
            export_apply=True, export_yup=True, export_animations=cfg["spin_animation"],
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        )
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:  # versiones sin alguno de los parámetros
            kwargs.pop("export_draco_mesh_compression_level", None)
            bpy.ops.export_scene.gltf(**kwargs)
        print(f"[RH] GLB → {base}.glb ({os.path.getsize(base + '.glb') / 1024:.0f} KB)")

    blend = base + ".blend"
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"[RH] Escena → {blend}")


def main(cfg=CONFIG):
    clear_scene()
    root, parts = build_coin(cfg)
    build_studio(cfg, root)
    if cfg["spin_animation"]:
        add_spin(root)
    export(cfg, root, parts)


if __name__ == "__main__":
    main()
