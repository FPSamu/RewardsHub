/**
 * DynamoDB falso en memoria para los tests de la réplica (P5). Implementa
 * solo lo que usa el código: BatchWrite (PutRequest), Put, Get y Query con
 * las dos formas de KeyConditionExpression que genera src/replica/*:
 *   "pk = :pk AND sk BETWEEN :from AND :to"            (tabla)
 *   "gsi1pk = :pk AND createdAt BETWEEN :from AND :to" (GSI byShift)
 * con paginación (Limit / LastEvaluatedKey) para probar que se sigue.
 */
import { BatchWriteCommand, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class FakeDynamo {
    tables = new Map<string, Map<string, any>>();
    calls: any[] = [];
    /** Cuántas veces devolver parte del batch como UnprocessedItems (para probar reintentos). */
    unprocessedRounds = 0;
    /** Si se pone, cada send lanza este error (DynamoDB caído). */
    failWith: Error | null = null;
    /** Tamaño de página de Query (para probar LastEvaluatedKey). */
    pageSize = 50;

    private table(name: string) {
        if (!this.tables.has(name)) this.tables.set(name, new Map());
        return this.tables.get(name)!;
    }

    items(name: string): any[] {
        return Array.from(this.table(name).values());
    }

    async send(cmd: any): Promise<any> {
        this.calls.push(cmd);
        if (this.failWith) throw this.failWith;
        const input = cmd.input;

        if (cmd instanceof BatchWriteCommand) {
            const unprocessed: Record<string, any[]> = {};
            for (const [name, requests] of Object.entries(input.RequestItems as Record<string, any[]>)) {
                let todo = requests;
                if (this.unprocessedRounds > 0) {
                    // devuelve la mitad sin procesar (o el único que quede)
                    this.unprocessedRounds--;
                    const half = requests.length > 1 ? Math.ceil(requests.length / 2) : 0;
                    unprocessed[name] = requests.slice(half);
                    todo = requests.slice(0, half);
                }
                if (requests.length > 25) throw new Error('ValidationException: más de 25 items en BatchWriteItem');
                for (const r of todo) this.table(name).set(`${r.PutRequest.Item.pk}|${r.PutRequest.Item.sk}`, structuredClone(r.PutRequest.Item));
            }
            return { UnprocessedItems: Object.keys(unprocessed).length ? unprocessed : {} };
        }
        if (cmd instanceof PutCommand) {
            this.table(input.TableName).set(`${input.Item.pk}|${input.Item.sk}`, structuredClone(input.Item));
            return {};
        }
        if (cmd instanceof GetCommand) {
            return { Item: this.table(input.TableName).get(`${input.Key.pk}|${input.Key.sk}`) };
        }
        if (cmd instanceof QueryCommand) {
            const v = input.ExpressionAttributeValues;
            const [hashAttr, rangeAttr] = input.IndexName === 'byShift' ? ['gsi1pk', 'createdAt'] : ['pk', 'sk'];
            const expected = `${hashAttr} = :pk AND ${rangeAttr} BETWEEN :from AND :to`;
            if (input.KeyConditionExpression !== expected) throw new Error(`Query no soportada: ${input.KeyConditionExpression}`);
            const all = this.items(input.TableName)
                .filter((it) => it[hashAttr] === v[':pk'] && it[rangeAttr] >= v[':from'] && it[rangeAttr] <= v[':to'])
                .sort((a, b) => (a[rangeAttr] < b[rangeAttr] ? -1 : a[rangeAttr] > b[rangeAttr] ? 1 : (a.sk < b.sk ? -1 : 1)));
            const start = input.ExclusiveStartKey ? all.findIndex((it) => it.pk === input.ExclusiveStartKey.pk && it.sk === input.ExclusiveStartKey.sk) + 1 : 0;
            const page = all.slice(start, start + this.pageSize);
            const last = page[page.length - 1];
            return { Items: page.map((it) => structuredClone(it)), LastEvaluatedKey: start + this.pageSize < all.length ? { pk: last.pk, sk: last.sk } : undefined };
        }
        throw new Error(`Comando no soportado: ${cmd.constructor.name}`);
    }
}
