# Réplica de lectura en DynamoDB (P5): estadísticas diarias y transacciones
# para los reportes. La llena el job replicate-dynamo (cada 10 min) desde Mongo.
#
# enable_dynamo = false (default) no crea nada. La prueba de DynamoDB en el
# lab (P5.0) está pendiente: ver README → Limitaciones.
#
# PAY_PER_REQUEST (sin capacidad reservada: con poco tráfico cuesta casi
# nada), sin PITR ni tablas globales. Las instancias acceden con LabRole
# (LabInstanceProfile); no hace falta crear roles.

resource "aws_dynamodb_table" "daily_stats" {
  count        = var.enable_dynamo ? 1 : 0
  name         = "${var.project}-daily-stats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk" # BIZ#<businessId>  (META#replication = marcas del job)
  range_key    = "sk" # DAY#<yyyy-mm-dd>#BR#<branchId|ALL|NONE>

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = false
  }
}

resource "aws_dynamodb_table" "transactions" {
  count        = var.enable_dynamo ? 1 : 0
  name         = "${var.project}-transactions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk" # BIZ#<businessId>
  range_key    = "sk" # <createdAt ISO>#<txId>

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # Reportes por turno: BIZ#<businessId>#SHIFT#<workShiftId>, ordenado por createdAt.
  # Solo las transacciones con turno tienen gsi1pk (índice disperso).
  global_secondary_index {
    name            = "byShift"
    hash_key        = "gsi1pk"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = false
  }
}

locals {
  ddb_daily_stats_table  = try(aws_dynamodb_table.daily_stats[0].name, "")
  ddb_transactions_table = try(aws_dynamodb_table.transactions[0].name, "")
}
