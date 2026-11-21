# Frontend (Vite/React) como sitio estático de S3.
#
# El Learner Lab no permite CloudFront (ni distribuciones, ni OAC, ni
# funciones), así que no hay HTTPS: el frontend se sirve por HTTP desde el
# endpoint de website de S3 y llama a la API por HTTP en el ALB (con CORS).
#
#   http://<bucket>.s3-website-<región>.amazonaws.com  → frontend
#   http://<alb>.elb.amazonaws.com                     → API

locals {
  # Ruta absoluta (p. ej. /home/luis/rew_hub/rew_hub_front/RewardsHubFront) o relativa a infra/aws
  frontend_dir = startswith(var.frontend_dir, "/") ? var.frontend_dir : abspath("${path.module}/${var.frontend_dir}")
  # Cambia cuando cambia el código del frontend → se recompila y se resube.
  frontend_files = var.enable_frontend ? sort(concat(
    tolist(fileset(local.frontend_dir, "src/**")),
    tolist(fileset(local.frontend_dir, "public/**")),
    [for f in ["index.html", "package-lock.json", "vite.config.js", "tailwind.config.js", "postcss.config.cjs", ".env.local", ".env.production"] :
    f if fileexists("${local.frontend_dir}/${f}")],
  )) : []
  frontend_hash = sha1(join("", [for f in local.frontend_files : filesha1("${local.frontend_dir}/${f}")]))
  frontend_url  = var.enable_frontend ? aws_cloudformation_stack.frontend[0].outputs["WebsiteURL"] : ""
}

# Bucket vía CloudFormation por la misma SCP del lab que en artifact.tf.
# Lectura pública (es un sitio web) y error document = index.html para que las
# rutas de la SPA (/login, /business/...) carguen la app.
resource "aws_cloudformation_stack" "frontend" {
  count = var.enable_frontend ? 1 : 0
  name  = "${var.project}-frontend"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      Bucket = {
        Type           = "AWS::S3::Bucket"
        DeletionPolicy = "Delete"
        Properties = {
          BucketName = "${var.project}-lab-frontend-${random_id.suffix.hex}"
          PublicAccessBlockConfiguration = {
            BlockPublicAcls       = true
            IgnorePublicAcls      = true
            BlockPublicPolicy     = false
            RestrictPublicBuckets = false
          }
          WebsiteConfiguration = {
            IndexDocument = "index.html"
            ErrorDocument = "index.html"
          }
        }
      }
      PublicRead = {
        Type = "AWS::S3::BucketPolicy"
        Properties = {
          Bucket = { Ref = "Bucket" }
          PolicyDocument = {
            Version = "2012-10-17"
            Statement = [{
              Sid       = "PublicReadForWebsite"
              Effect    = "Allow"
              Principal = "*"
              Action    = "s3:GetObject"
              Resource  = { "Fn::Join" = ["", [{ "Fn::GetAtt" = ["Bucket", "Arn"] }, "/*"]] }
            }]
          }
        }
      }
    }
    Outputs = {
      BucketName = { Value = { Ref = "Bucket" } }
      WebsiteURL = { Value = { "Fn::GetAtt" = ["Bucket", "WebsiteURL"] } }
    }
  })
}

# Compila el frontend en tu máquina y lo sube. Se repite cuando cambia el
# código o la URL de la API. Al destruir, vacía el bucket para que
# CloudFormation pueda borrarlo.
resource "terraform_data" "frontend_deploy" {
  count = var.enable_frontend ? 1 : 0

  triggers_replace = {
    hash   = local.frontend_hash
    bucket = aws_cloudformation_stack.frontend[0].outputs["BucketName"]
    url    = local.frontend_url
    api    = aws_lb.api.dns_name
  }

  input = {
    bucket  = aws_cloudformation_stack.frontend[0].outputs["BucketName"]
    profile = var.aws_profile
    region  = var.region
  }

  provisioner "local-exec" {
    working_dir = local.frontend_dir
    environment = {
      AWS_PROFILE  = var.aws_profile
      AWS_REGION   = var.region
      VITE_API_URL = "http://${aws_lb.api.dns_name}"
      VITE_APP_URL = local.frontend_url
      OUT          = abspath("${path.module}/.build/frontend")
      BUCKET       = aws_cloudformation_stack.frontend[0].outputs["BucketName"]
    }
    command = <<-SH
      set -e
      [ -d node_modules ] || npm ci --no-audit --no-fund
      npx vite build --outDir "$OUT" --emptyOutDir
      aws s3 sync "$OUT/assets" "s3://$BUCKET/assets" --delete --cache-control "public,max-age=31536000,immutable"
      aws s3 sync "$OUT" "s3://$BUCKET" --delete --exclude "assets/*" --cache-control "no-cache"
    SH
  }

  provisioner "local-exec" {
    when    = destroy
    command = "aws s3 rm s3://${self.input.bucket} --recursive --profile ${self.input.profile} --region ${self.input.region} || true"
  }
}
