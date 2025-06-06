//  Função para obter a query de inserção de uma reserva
import { loadErrorMessages } from "../../index.js";
import { v4 as uuidv4 } from "uuid";

const messages = await loadErrorMessages("pt-BR");
export function getInsertQuery() {
  return `INSERT INTO \`ORDER\` (
      Created, Imported, Expiration, Confirmation,
      Business, Version, Identifier, Hash, Language,
      Status, Type, StartDate, EndDate, Channel,
      Locator, IDCompany, Company, IDClient, Client,
      IDAgent, Agent, IDManager, Manager, IDAttendant, Attendant,
      IDUser, User, IDCustomer, Customer,
      Price, Discount, Taxes, Markup, Commission,
      Cost, Rav, Total, Information, Notes
    ) VALUES (?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?)`;
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

// Função para verificar duplicidade de reserva
export async function checkDuplicateReservation(
  connection,
  identifier,
  business,
) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMO, Hash, Version FROM `ORDER` WHERE Identifier = ? AND Business = ? LIMIT 1",
      [identifier, business],
    );
    return existing.length > 0 ? existing[0] : null;
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

// Função para preparar os dados da reserva
export function prepareReservationData(business, reservation, hash) {
  const version = 1;
  const now = new Date();

  return [
    now, // Created
    now, // Imported
    reservation.expiresAt ? new Date(reservation.expiresAt) : null, // Expiration
    reservation.confirmation ? new Date(reservation.confirmation) : null, // Confirmation
    business, // Business
    version, // Version
    reservation.identifier, // Identifier
    hash, // Hash
    reservation.language || "pt-br", // Language
    reservation.status || "pending", // Status
    reservation.type || "standard", // Type
    new Date(reservation.period.start), // StartDate
    new Date(reservation.period.end), // EndDate
    reservation.channel?.name || "unknown", // Channel
    reservation.locator || null, // Locator

    // Company data
    reservation.company?.id || null,
    reservation.company?.name || "",

    // Client data
    reservation.client?.id || null,
    reservation.client?.name || "",

    // Agent data
    reservation.agent?.id || null,
    reservation.agent ? getFullName(reservation.agent) : "",

    // Manager data
    reservation.manager?.id || null,
    reservation.manager ? getFullName(reservation.manager) : "",

    // Attendant data
    reservation.attendant?.id || null,
    reservation.attendant ? getFullName(reservation.attendant) : null,

    // User data
    reservation.user?.id || null,
    reservation.user ? getFullName(reservation.user) : "",

    // Customer data
    reservation.customer?.id || null,
    reservation.customer ? getFullName(reservation.customer) : "",

    // Financial
    reservation.total?.service?.price || 0.0,
    reservation.total?.service?.discount || 0.0,
    reservation.total?.service?.tax || 0.0,
    reservation.total?.service?.markup || 0.0,
    reservation.total?.service?.commission || 0.0,
    reservation.total?.service?.price || 0.0, // Cost
    0.0, // Rav
    reservation.total?.total || 0.0, // Total

    // Extra info
    reservation.information || "",
    "", // Notes
  ];
}
