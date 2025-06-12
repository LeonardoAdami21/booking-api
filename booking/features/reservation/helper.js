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

function createSafeDate(dateValue, fallback = new Date()) {
  if (!dateValue) return fallback;

  const date = new Date(dateValue);
  return isNaN(date.getTime()) ? fallback : date;
}

function formatSafeDate(dateValue, fallback = new Date()) {
  const date = createSafeDate(dateValue, fallback);
  return date.toISOString().split("T")[0];
}

function parseIntegerField(value, defaultValue = 0) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseFloatField(value, defaultValue = 0) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Função para obter a reserva inserida
export async function getInsertedReservation(connection, insertId) {
  try {
    const [result] = await connection.query(
      "SELECT IDMO, Business, Hash, Version, Created FROM `ORDER` WHERE IDMO = ? LIMIT 1",
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
export async function validateReservation(reservation) {
  // Validação básica de campos obrigatórios

  // Validar período (se obrigatório)
  if (!reservation.period.start || !reservation.period.end) {
    return messages["E123"] || "Período é obrigatório";
  }

  // Validar datas se período for fornecido
  if (reservation.period?.start && reservation.period?.end) {
    const startDate = createSafeDate(reservation.period.start);
    const endDate = createSafeDate(reservation.period.end);

    if (isNaN(startDate.getTime())) {
      throw new Error("Data de início inválida");
    }

    if (isNaN(endDate.getTime())) {
      throw new Error("Data de fim inválida");
    }

    if (endDate <= startDate) {
      throw new Error(
        messages["E110"] || "Data de fim deve ser posterior à data de início",
      );
    }
  }

  if(reservation.pax && typeof reservation.pax === "object") {
    for (const paxId in reservation.pax) {
      const pax = reservation.pax[paxId];
      if (pax.main) {
        if (!pax.firstName || !pax.lastName || !pax.document || !pax.birthdate || !pax.gender) {
          return messages["E116"] || "Informações do passageiro principal é obrigatória";
        }
      }
    }
  }

  return { valid: true, pax: reservation.pax };
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

const DEFAULT_EXPIRATION_DAYS = 30;
const DEFAULT_PAX_ADULT = 2;
// Função para preparar os dados da reserva (simplificada)
export function prepareReservationData(business, reservation, hash) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  const data = {
    Created: now,
    Updated: now,
    Expiration: reservation.expiresAt ? new Date(reservation.expiresAt) : null,
    Confirmation: reservation.confirmation
      ? new Date(reservation.confirmation)
      : null,
    Business: business,
    Version: reservation.version || 1,
    Identifier: uuidv4(),
    Hash: hash,
    Language: reservation.language || "pt-br",
    Status: reservation.status || "pending",
    Type: reservation.type || "standard",
    StartDate: formatSafeDate(reservation.period?.start, now),
    EndDate: formatSafeDate(reservation.period?.end, expirationDate),
    Channel: reservation.channel?.name || "unknown",
    Locator: reservation?.conector?.code || null,

    // Company data
    IDCompany: reservation.company?.id || null,
    Company: reservation.company?.name || "",

    // Client data
    IDClient: reservation.client?.id || null,
    Client: reservation.client?.name || "",

    // Agent data
    IDAgent: reservation.agent?.id || null,
    Agent: reservation.agent ? getFullName(reservation.agent) : "",

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
