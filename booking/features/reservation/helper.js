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
      "SELECT IDMO, Version, Created FROM `ORDER` WHERE IDMO = ? LIMIT 1",
      [insertId],
    );
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    return {
      id: null,
      type: "reservation",
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
      SELECT IDMO, Identifier, IDIssuer, Issuer, Version, Created, Status, Booking
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
      version: null,
      reservation: null,
      error: "E118",
      message: messages["E118"],
    };
  }
}

// Função para verificar duplicidade de reserva (refatorada)
export async function checkDuplicateReservation(connection, identifier) {
  try {
    const existing = await findReservation(connection, {
      Identifier: identifier,
    });

    if (existing && !existing.error) {
      return {
        id: existing.IDMO,
        type: "reservation",
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
      version: null,
      reservation: null,
      error: "E117",
      message: messages["E117"],
    };
  }
}

// Função para validar reserva
export async function validateReservation(create) {
  // Validação básica de campos obrigatórios

  if (create.pax && typeof create.pax === "object") {
    for (const paxId in create.pax) {
      const pax = create.pax[paxId];
      if (pax.main) {
        if (
          !pax.firstName ||
          !pax.lastName ||
          !pax.document ||
          !pax.birthdate ||
          !pax.gender
        ) {
          return (
            messages["E116"] ||
            "Informações do passageiro principal é obrigatória"
          );
        }
      }
    }
  }

  return { valid: true, pax: create.pax };
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
export function prepareReservationData(channel, create) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  const data = {
    Created: now,
    Updated: now,
    Confirmation: create.confirmation ? new Date(create.confirmation) : null,
    Version: create.version || 1,
    Identifier: uuidv4(),
    Status: create.status || "pending",
    Channel: channel || "unknown",
    Locator: create?.conector?.code || null,

    // Issuer data
    IDIssuer: create.issuer?.id || null,
    Issuer: create.issuer?.name || "",

    // User data
    IDUser: create.user?.id || null,
    User: create.user ? getFullName(create.user) : "",

    // Customer data
    IDCustomer: create.customer?.id || null,
    Customer: create.customer ? getFullName(create.customer) : "",

    // Financial
    Price: create.total?.service?.price || 0.0,
    Discount: create.total?.service?.discount || 0.0,
    Markup: create.total?.service?.markup || 0.0,
    Commission: create.total?.service?.commission || 0.0,
    Cost: create.total?.service?.price || 0.0,
    Total: create.total?.total || 0.0,

    // Extra info
    Information: create.information || "",
    Notes: create.notes || "",

    Booking: create?.channel?.booking || null,
  };

  return data;
}
