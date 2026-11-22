# MongoDB 7.0 dentro del lab (EC2), base principal de la API y los workers.
#
# El lab nunca se conecta a Atlas ni a ninguna base fuera de AWS: Terraform
# arma MONGO_URI con la IP privada de esta instancia y lo escribe en
# /etc/rewardshub.env (gana sobre el .env.lab, que NO debe traer MONGO_URI;
# ver la precondición de aws_s3_object.env en artifact.tf).
#
# - Una sola instancia, sin ASG: replica set de un nodo (rs0), que es lo que
#   pide src/db/withTransaction.ts para usar transacciones.
# - Docker con la imagen oficial mongo:7.0 (fijada, nunca latest), manejada por systemd.
# - Auth: usuario admin (root) y usuario app con readWrite SOLO en la base del lab.
#   Contraseñas y keyfile del replica set salen de random_password: viven en
#   el estado de Terraform (local, fuera de git) y en archivos solo-root de la
#   instancia. lab.sh nunca manda contraseñas como parámetros de SSM.
# - Datos en un volumen gp3 aparte (/data/db) que se borra con la instancia:
#   son desechables y se pierden con ./lab.sh down.
#
# enable_mongo = false no crea nada y no escribe MONGO_URI (la app arranca sin
# base; solo sirve para probar la infraestructura).

locals {
  # IP privada fija: .10 de la primera subred pública (AWS reserva .0–.3 y la última)
  mongo_private_ip = cidrhost(aws_subnet.public[0].cidr_block, 10)
  mongo_app_user   = "app"
  mongo_db_name    = var.lab_db_name != "" ? var.lab_db_name : "rewardshub_lab"

  mongo_uri = var.enable_mongo ? format(
    "mongodb://%s:%s@%s:27017/%s?replicaSet=rs0&authSource=%s",
    local.mongo_app_user,
    urlencode(random_password.mongo_app[0].result),
    local.mongo_private_ip,
    local.mongo_db_name,
    local.mongo_db_name,
  ) : ""
}

resource "random_password" "mongo_admin" {
  count   = var.enable_mongo ? 1 : 0
  length  = 32
  special = false # alfanumérica: va en un URI y en JSON sin escapar nada
}

resource "random_password" "mongo_app" {
  count   = var.enable_mongo ? 1 : 0
  length  = 32
  special = false
}

# Keyfile del replica set (autenticación interna). Solo caracteres base64
# válidos (los alfanuméricos lo son), entre 6 y 1024.
resource "random_password" "mongo_keyfile" {
  count   = var.enable_mongo ? 1 : 0
  length  = 756
  special = false
}

resource "aws_security_group" "mongo" {
  count       = var.enable_mongo ? 1 : 0
  name        = "${var.project}-mongo"
  description = "MongoDB: 27017 solo desde la API y los workers"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "MongoDB desde API y workers"
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
  }

  dynamic "ingress" {
    for_each = var.key_name == null ? [] : [1]
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # Salida: dnf y docker pull (no hay NAT; la instancia tiene IP pública)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "mongo" {
  count                  = var.enable_mongo ? 1 : 0
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.mongo_instance_type
  subnet_id              = aws_subnet.public[0].id
  private_ip             = local.mongo_private_ip
  vpc_security_group_ids = [aws_security_group.mongo[0].id]
  iam_instance_profile   = var.instance_profile_name
  key_name               = var.key_name

  metadata_options {
    http_tokens                 = "required" # IMDSv2, como las demás instancias
    http_put_response_hop_limit = 2
  }

  # Volumen de datos aparte del de sistema; se borra con la instancia.
  ebs_block_device {
    device_name           = "/dev/sdf"
    volume_type           = "gp3"
    volume_size           = var.mongo_volume_gb
    delete_on_termination = true
    encrypted             = true # probado en el lab (README → Limitaciones)
  }

  user_data = templatefile("${path.module}/user_data_mongo.sh.tftpl", {
    image       = var.mongo_image
    private_ip  = local.mongo_private_ip
    db_name     = local.mongo_db_name
    app_user    = local.mongo_app_user
    admin_pw    = random_password.mongo_admin[0].result
    app_pw      = random_password.mongo_app[0].result
    keyfile     = random_password.mongo_keyfile[0].result
    wt_cache_gb = var.mongo_wiredtiger_cache_gb
  })

  lifecycle {
    # Una AMI nueva de AL2023 (most_recent) o un cambio del script NO deben
    # reemplazar la instancia a media sesión: se perderían los datos.
    # Para tomar un user_data nuevo: ./lab.sh down && ./lab.sh up.
    ignore_changes = [ami, user_data]
  }

  tags = { Name = "${var.project}-mongo", Role = "mongo" }
}
