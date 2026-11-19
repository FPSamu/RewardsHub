terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }

  # Estado local (terraform.tfstate en esta carpeta). En el Learner Lab las
  # credenciales cambian en cada sesión, pero la cuenta y los recursos no,
  # así que el estado local sirve para destruir lo creado en sesiones previas.
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Purpose   = "sistemas-escalables"
    }
  }
}
