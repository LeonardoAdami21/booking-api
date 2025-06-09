// Função para obter a query de inserção de uma reserva
import { loadErrorMessages } from "../../index.js";
import { v4 as uuidv4 } from "uuid";

const messages = await loadErrorMessages("pt-BR");

export function getInsertQuery(serviceData) {
  const fields = [];
  const values = [];
  const placeholders = [];

  for (const [key, value] of Object.entries(serviceData)) {
    if (value !== null && value !== undefined) {
      fields.push(key);
      values.push(value);
      placeholders.push("?");
    }
  }

  const query = `
    INSERT INTO \`ORDER\` (${fields.join(", ")})
    VALUES (${placeholders.join(", ")})
  `;

  return { query, values };
}

// Função para obter a query de atualização de uma reserva
export function getUpdateQuery(serviceData, whereConditions = {}) {
  const fields = [];
  const values = [];
  const whereFields = [];
  const whereValues = [];

  // Monta os campos para UPDATE
  for (const [key, value] of Object.entries(serviceData)) {
    if (value !== null && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  // Monta as condições WHERE
  for (const [key, value] of Object.entries(whereConditions)) {
    if (value !== null && value !== undefined) {
      whereFields.push(`${key} = ?`);
      whereValues.push(value);
    }
  }

  if (fields.length === 0) {
    throw new Error("Nenhum campo para atualizar foi fornecido");
  }

  if (whereFields.length === 0) {
    throw new Error("Nenhuma condição WHERE foi fornecida");
  }

  const query = `
    UPDATE \`ORDER\` 
    SET ${fields.join(", ")}
    WHERE ${whereFields.join(" AND ")}
  `;

  return {
    query,
    values: [...values, ...whereValues],
  };
}

// Função para obter a reserva inserida
export async function getInsertedReservation(connection, insertId) {
  try {
    const [result] = await connection.query(
      "SELECT IDMO, Business, Identifier, Hash, Version, Created FROM `ORDER` WHERE IDMO = ? LIMIT 1",
      [insertId],
    );
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    return {
      id: null,
      type: "reservation",
      business: null,
      hash: null,
      version: null,
      reservation: null,
      error: "E118",
      message: messages["E118"],
    };
  }
}

// Função para buscar reserva por múltiplos critérios
export async function findReservation(connection, searchCriteria) {
  const whereFields = [];
  const whereValues = [];

  // Monta as condições WHERE dinamicamente
  for (const [key, value] of Object.entries(searchCriteria)) {
    if (value !== null && value !== undefined) {
      whereFields.push(`${key} = ?`);
      whereValues.push(value);
    }
  }

  if (whereFields.length === 0) {
    throw new Error("Nenhum critério de busca foi fornecido");
  }

  try {
    const query = `
      SELECT IDMO, Business, Identifier, Hash, Version, Created, Status
      FROM \`ORDER\` 
      WHERE ${whereFields.join(" AND ")} 
      LIMIT 1
    `;

    const [result] = await connection.query(query, whereValues);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    return {
      id: null,
      type: "reservation",
      business: null,
      hash: null,
      version: null,
      reservation: null,
      error: "E118",
      message: messages["E118"],
    };
  }
}

// Função para verificar duplicidade de reserva (refatorada)
export async function checkDuplicateReservation(
  connection,
  identifier,
  business,
) {
  try {
    const existing = await findReservation(connection, {
      Identifier: identifier,
      Business: business,
    });

    if (existing && !existing.error) {
      return {
        id: existing.IDMO,
        type: "reservation",
        business: business,
        hash: existing.Hash,
        version: existing.Version,
        reservation: null,
        error: null,
        message: null,
      };
    }

    return null; // Não encontrou duplicata
  } catch (error) {
    return {
      id: null,
      type: "reservation",
      business: business,
      hash: null,
      version: null,
      reservation: null,
      error: "E117",
      message: messages["E117"],
    };
  }
}

// Função para validar reserva
export function validateReservation(reservation) {
  // Validação básica de campos obrigatórios
  if (!reservation.identifier) {
    return {
      error: "E112",
      message: messages["E112"],
    };
  }

  if (
    !reservation.period ||
    !reservation.period.start ||
    !reservation.period.end
  ) {
    return {
      error: "E113",
      message: messages["E113"],
    };
  }

  const startDate = new Date(reservation.period.start);
  const endDate = new Date(reservation.period.end);
  const today = new Date();

  // Remove horas para comparação apenas de datas
  today.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  if (startDate < today) {
    return {
      error: "E110",
      message: messages["E110"],
    };
  }

  if (endDate <= startDate) {
    return {
      error: "E111",
      message: messages["E111"],
    };
  }

  return null;
}

// Função para gerar um hash
export function generateHash() {
  return uuidv4().replace(/-/g, "");
}

// Função para obter o nome completo
export function getFullName(person) {
  if (!person) return "";
  const firstName = person.firstName || "";
  const lastName = person.lastName || "";
  return `${firstName} ${lastName}`.trim();
}

// Função para preparar os dados da reserva (simplificada)
export function prepareReservationData(business, reservation, hash) {
  const version = 1;
  const now = new Date();

  const data = {
    Created: now,
    Updated: now,
    Expiration: reservation.expiresAt ? new Date(reservation.expiresAt) : null,
    Confirmation: reservation.confirmation
      ? new Date(reservation.confirmation)
      : null,
    Business: business,
    Version: version,
    Identifier: reservation.identifier,
    Hash: hash,
    Language: reservation.language || "pt-br",
    Status: reservation.status || "pending",
    Type: reservation.type || "standard",
    StartDate: new Date(reservation.period.start),
    EndDate: new Date(reservation.period.end),
    Channel: reservation.channel?.name || "unknown",
    Locator: reservation.locator || null,

    // Company data
    IDCompany: reservation.company?.id || null,
    Company: reservation.company?.name || "",

    // Client data
    IDClient: reservation.client?.id || null,
    Client: reservation.client?.name || "",

    // Agent data
    IDAgente: reservation.agent?.id || null,
    Agente: reservation.agent ? getFullName(reservation.agent) : "",

    // Attendant data
    IDAttendant: reservation.attendant?.id || null,
    Attendant: reservation.attendant
      ? getFullName(reservation.attendant)
      : null,

    // User data
    IDUser: reservation.user?.id || null,
    User: reservation.user ? getFullName(reservation.user) : "",

    // Customer data
    IDCustomer: reservation.customer?.id || null,
    Customer: reservation.customer ? getFullName(reservation.customer) : "",

    // Financial
    Price: reservation.total?.service?.price || 0.0,
    Discount: reservation.total?.service?.discount || 0.0,
    Taxes: reservation.total?.service?.tax || 0.0,
    Markup: reservation.total?.service?.markup || 0.0,
    Commission: reservation.total?.service?.commission || 0.0,
    Cost: reservation.total?.service?.price || 0.0,
    Rav: reservation.total?.service?.price || 0.0,
    Total: reservation.total?.total || 0.0,

    // Extra info
    Information: reservation.information || "",
    Notes: reservation.notes || "",
  };

  return data;
}

// Função para atualizar uma reserva existente
export async function updateReservation(
  connection,
  reservationId,
  updateData,
  business,
) {
  try {
    // Adiciona dados de controle
    const dataToUpdate = {
      ...updateData,
      Updated: new Date(),
    };

    const whereConditions = {
      IDMO: reservationId,
      Business: business,
    };

    const { query, values } = getUpdateQuery(dataToUpdate, whereConditions);

    const [result] = await connection.query(query, values);

    if (result.affectedRows > 0) {
      // Busca e retorna a reserva atualizada
      return await getInsertedReservation(connection, reservationId);
    }

    return null;
  } catch (error) {
    throw new Error(`Erro ao atualizar reserva: ${error.message}`);
  }
}

// Função para buscar reservas com filtros dinâmicos
export async function searchReservations(
  connection,
  filters = {},
  limit = 50,
  offset = 0,
) {
  const whereFields = [];
  const whereValues = [];

  // Monta as condições WHERE dinamicamente
  for (const [key, value] of Object.entries(filters)) {
    if (value !== null && value !== undefined) {
      if (Array.isArray(value)) {
        // Para arrays, usa IN
        const placeholders = value.map(() => "?").join(", ");
        whereFields.push(`${key} IN (${placeholders})`);
        whereValues.push(...value);
      } else if (typeof value === "string" && value.includes("%")) {
        // Para strings com %, usa LIKE
        whereFields.push(`${key} LIKE ?`);
        whereValues.push(value);
      } else {
        // Para valores exatos
        whereFields.push(`${key} = ?`);
        whereValues.push(value);
      }
    }
  }

  try {
    let query = `
      SELECT IDMO, Business, Identifier, Hash, Version, Created, Updated, 
             Status, StartDate, EndDate, Client, Customer, Total
      FROM \`ORDER\`
    `;

    if (whereFields.length > 0) {
      query += ` WHERE ${whereFields.join(" AND ")}`;
    }

    query += ` ORDER BY Created DESC LIMIT ? OFFSET ?`;

    const [results] = await connection.query(query, [
      ...whereValues,
      limit,
      offset,
    ]);
    return results;
  } catch (error) {
    throw new Error(`Erro ao buscar reservas: ${error.message}`);
  }
}
