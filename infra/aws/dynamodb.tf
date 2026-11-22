# Réplica de lectura en DynamoDB (P5): estadísticas diarias y transacciones
# para los reportes. La llena el job replicate-dynamo (cada 10 min) desde Mongo.
#
# enable_dynamo = true (default): probado en el lab (P5.0, README → Limitaciones).
# false no crea nada y todo se lee de Mongo.
#
# Aviso "hash_key is deprecated" de terraform validate: viene de los hash_key /
# range_key del global_secondary_index. Su reemplazo (bloque key_schema dentro
# del índice) solo existe en versiones recientes del provider 6.x; versions.tf
# pide >= 5.60, así que se deja como está (es solo un aviso).
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

check "stats_source_dynamo" {
  assert {
    condition     = var.stats_source != "dynamo" || var.enable_dynamo
    error_message = "stats_source = \"dynamo\" sin enable_dynamo: la API leerá todo de Mongo. Usa enable_dynamo = true o stats_source = \"daily\"."
  }
}

locals {
  ddb_daily_stats_table  = try(aws_dynamodb_table.daily_stats[0].name, "")
  ddb_transactions_table = try(aws_dynamodb_table.transactions[0].name, "")
}
