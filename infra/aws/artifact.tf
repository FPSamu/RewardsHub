# El código viaja a las instancias como un zip en S3 (sin Docker ni acceso a
# git desde EC2). Cada cambio en el código cambia el hash → nueva versión del
# launch template → el ASG reemplaza instancias de forma escalonada.

resource "random_id" "suffix" {
  byte_length = 4
}

# El bucket se crea con CloudFormation y no con `aws_s3_bucket`: ese recurso
# siempre lee la configuración de Object Lock, y la SCP del Learner Lab niega
# s3:GetBucketObjectLockConfiguration (AccessDenied → el apply falla).
# Al destruir, Terraform borra primero los objetos y luego el stack, así que
# el bucket ya está vacío cuando CloudFormation lo elimina.
resource "aws_cloudformation_stack" "artifacts" {
  name = "${var.project}-artifacts"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      Bucket = {
        Type           = "AWS::S3::Bucket"
        DeletionPolicy = "Delete"
        Properties = {
          BucketName = "${var.project}-lab-artifacts-${random_id.suffix.hex}"
          PublicAccessBlockConfiguration = {
            BlockPublicAcls       = true
            BlockPublicPolicy     = true
            IgnorePublicAcls      = true
            RestrictPublicBuckets = true
          }
          BucketEncryption = {
            ServerSideEncryptionConfiguration = [{
              ServerSideEncryptionByDefault = { SSEAlgorithm = "AES256" }
            }]
          }
        }
      }
    }
    Outputs = {
      BucketName = { Value = { Ref = "Bucket" } }
    }
  })
}

locals {
  artifacts_bucket = aws_cloudformation_stack.artifacts.outputs["BucketName"]
}

data "archive_file" "app" {
  type        = "zip"
  source_dir  = "${path.module}/../.."
  output_path = "${path.module}/.build/app.zip"
  excludes = [
    # Ningún .env viaja dentro del zip del código: el del lab va aparte (env_file).
    # ".env.*" (glob) cubre .env.lab, .env.local…; la app no necesita ni el .env.example.
    "node_modules", "dist", ".git", ".env", ".env.*", "infra", "logs", "coverage",
    "tests", ".vscode", ".cursor", ".DS_Store", "render.yaml",
  ]
}

resource "aws_s3_object" "app" {
  bucket                 = local.artifacts_bucket
  key                    = "app/${data.archive_file.app.output_md5}.zip"
  source                 = data.archive_file.app.output_path
  etag                   = data.archive_file.app.output_md5
  server_side_encryption = "AES256"
}

resource "aws_s3_object" "env" {
  bucket                 = local.artifacts_bucket
  key                    = "config/${filemd5(var.env_file)}.env"
  source                 = var.env_file
  etag                   = filemd5(var.env_file)
  server_side_encryption = "AES256"

  lifecycle {
    # El lab nunca se conecta a Atlas ni a otra base fuera de AWS: MONGO_URI lo
    # pone Terraform (mongo.tf) en /etc/rewardshub.env. Si el env_file trae uno,
    # los scripts o un cambio futuro podrían terminar usándolo.
    precondition {
      condition     = !can(regex("(?m)^[ \\t]*(export[ \\t]+)?MONGO_URI[ \\t]*=", file(var.env_file))) && !can(regex("mongodb\\+srv:", file(var.env_file)))
      error_message = "El env_file no debe traer MONGO_URI ni ningún URI SRV de MongoDB (Atlas): el lab usa la MongoDB de mongo.tf. Bórralo de .env.lab."
    }
  }
}
