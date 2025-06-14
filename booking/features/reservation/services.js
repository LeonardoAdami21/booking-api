import { loadErrorMessages } from "../../index.js";
import { v4 as uuidv4 } from "uuid";
const messages = await loadErrorMessages("pt-BR");

// ============================================================================
// CONSTANTES E CONFIGURAÇÕES
// ============================================================================

const SERVICE_TYPES = {
  ROOM: "room",
  TRANSFER: "transfer",
  TICKET: "ticket",
  RENTAL: "rental",
  TOUR: "tour",
  INSURANCE: "insurance",
  FLIGHT: "flight",
  MEETING: "meeting",
  NOTE: "note",
};

const DEFAULT_EXPIRATION_DAYS = 30;
const DEFAULT_PAX_ADULT = 2;

// ============================================================================
// FUNÇÕES UTILITÁRIAS
// ============================================================================

function createSafeDate(dateValue, fallback = new Date()) {
  if (!dateValue) return fallback;
  const date = new Date(dateValue);
  return isNaN(date.getTime()) ? fallback : date;
}

function formatSafeDate(dateValue, fallback = new Date()) {
  const date = createSafeDate(dateValue, fallback);
  return date.toISOString().split("T")[0];
}

function parseNumber(value, defaultValue = 0, isFloat = false) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = isFloat ? parseFloat(value) : parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function createResponse(success, data = {}, error = null) {
  const response = { success };

  if (success) {
    return { ...response, ...data };
  }

  return {
    ...response,
    error: error?.code || "UNKNOWN_ERROR",
    message: error?.message || messages[error?.code] || "Erro desconhecido",
  };
}

// ============================================================================
// VALIDAÇÕES
// ============================================================================

function validateServiceData(serviceData, options = {}) {
  const {
    requireIdentifier = true,
    requirePeriod = true,
    requireSupplier = false,
    requirePax = false,
  } = options;

  if (!serviceData.identifier) {
    throw new Error(messages["E115"] || "Identificador é obrigatório");
  }

  if (
    requirePeriod &&
    (!serviceData.period?.start || !serviceData.period?.end)
  ) {
    throw new Error(messages["E123"] || "Período é obrigatório");
  }

  if (requireSupplier && !serviceData.supplier?.id) {
    throw new Error(messages["E124"] || "Fornecedor é obrigatório");
  }

  if (requirePax && !serviceData.pax?.adult && !serviceData.pax?.child) {
    throw new Error(
      messages["E125"] || "Informações de ocupação são obrigatórias",
    );
  }

  // Validar datas se período for fornecido
  if (serviceData.period?.start && serviceData.period?.end) {
    const startDate = createSafeDate(serviceData.period.start);
    const endDate = createSafeDate(serviceData.period.end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error("Datas inválidas");
    }

    if (endDate <= startDate) {
      throw new Error(
        messages["E110"] || "Data de fim deve ser posterior à data de início",
      );
    }
  }

  return { valid: true };
}

// ============================================================================
// FUNÇÕES DE BANCO DE DADOS
// ============================================================================

export async function validateReservationExists(connection, idmo, business) {
  try {
    const [result] = await connection.query(
      `SELECT IDMO, Business, Identifier, Status, IDAgent, Agent, 
              IDUser, User
       FROM \`ORDER\`
       WHERE IDMO = ? AND Business = ?
       LIMIT 1`,
      [idmo, business],
    );

    if (result.length === 0) {
      return createResponse(false, {}, { code: "E116" });
    }

    const reservation = result[0];

    if (reservation.Status === "cancelled") {
      return createResponse(false, {}, { code: "E126" });
    }

    return createResponse(true, { reservation });
  } catch (error) {
    console.error("Erro na validação da reserva:", error);
    throw new Error(messages["E114"] || "Erro na validação da reserva");
  }
}

export async function checkDuplicateService(connection, identifier, idmo) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMOS, Identifier, Status FROM `SERVICE` WHERE Identifier = ? AND IDMO = ? LIMIT 1",
      [identifier, idmo],
    );
    return existing.length > 0 ? existing[0] : null;
  } catch (error) {
    return createResponse(false, {}, { code: "E127" });
  }
}

export async function getInsertedService(connection, serviceId) {
  try {
    if (!connection || !serviceId) {
      return createResponse(
        false,
        {},
        { code: "E130", message: "Parâmetros inválidos" },
      );
    }

    const [result] = await connection.query(
      `SELECT IDMOS, IDMO, Identifier, Status, Description, Price, Total, 
              Currency,IDAttendant, Attendant, StartDate, EndDate, Information, People, Source, Options
       FROM SERVICE 
       WHERE IDMOS = ? LIMIT 1`,
      [serviceId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return createResponse(false, {}, { code: "E131" });
    }

    return createResponse(true, { service: result[0] });
  } catch (error) {
    console.error("Erro ao buscar serviço inserido:", error);
    return createResponse(false, {}, { code: "E127" });
  }
}

// ============================================================================
// PROCESSAMENTO DE PAX (DADOS VINDOS DO JSON EXTERNO)
// ============================================================================

// Função para processar dados de PAX
function processPaxData(assignedPaxIds, paxJsonData) {
  if (!paxJsonData || !assignedPaxIds) return [];

  const assignedIds = Array.isArray(assignedPaxIds)
    ? assignedPaxIds
    : [assignedPaxIds];

  return assignedIds
    .map((paxId) => {
      const paxDetails = paxJsonData[paxId];
      if (!paxDetails) return null;

      // Remove os campos desnecessários e mantém apenas a estrutura desejada
      const { id, assignment, ...paxFormatted } = paxDetails;

      return {
        main: paxFormatted.main || false,
        firstName: paxFormatted.firstName || "",
        lastName: paxFormatted.lastName || "",
        phone: paxFormatted.phone || "",
        email: paxFormatted.email || "",
        country: paxFormatted.country || "",
        document: {
          type: paxFormatted.document?.type || "",
          number: paxFormatted.document?.number || "",
        },
        birthdate: paxFormatted.birthdate || "",
        gender: paxFormatted.gender || "",
        ageGroup: paxFormatted.ageGroup || "",
      };
    })
    .filter((pax) => pax !== null);
}

// ============================================================================
// PREPARAÇÃO DE DADOS DO SERVIÇO
// ============================================================================

const VALID_SOURCES = [
  "manual",
  "connector",
  "import",
  "database",
  "api",
  "migration",
];

const DEFAULT_SOURCE = "manual";

function getValidSource(sourceValue) {
  // Se não foi fornecido um source, usar o padrão
  if (!sourceValue) {
    return DEFAULT_SOURCE;
  }

  // Converter para string e fazer lowercase para comparação
  const normalizedSource = String(sourceValue).toLowerCase().trim();

  // Verificar se o source é válido
  if (VALID_SOURCES.includes(normalizedSource)) {
    return normalizedSource;
  }

  // Se não for válido, retornar o padrão
  console.warn(
    `Source inválido: ${sourceValue}. Usando padrão: ${DEFAULT_SOURCE}`,
  );
  return DEFAULT_SOURCE;
}

function prepareServiceData(serviceData, reservation, processedPax) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Descrição dinâmica baseada no tipo
  let description = serviceData.description || "Descrição não disponível";
  if (serviceData.room?.category?.value) {
    description = `${serviceData.room.category.value} com ${serviceData.room.capacity?.value || "capacidade não informada"}`;
  } else if (serviceData.title) {
    description = serviceData.title;
  }

  // Informações do quarto
  let roomInfo = "";
  if (
    serviceData.room?.capacity?.code &&
    serviceData.room?.category?.code &&
    serviceData.board?.code
  ) {
    roomInfo = `${serviceData.room.capacity.code} - ${serviceData.room.category.code} - ${serviceData.board.code}`;
  }

  // Preparar dados base
  const baseData = {
    Created: now,
    Updated: now,
    Expiration: createSafeDate(serviceData.expiresAt, expirationDate),
    Confirmation: formatSafeDate(serviceData.confirmation, now),
    Identifier: reservation.identifier,
    Status: serviceData.status,
    IDMO: reservation.IDMO,
    Identifier: serviceData.identifier,
    Type: serviceData.type || SERVICE_TYPES.ROOM,
    Code: parseNumber(serviceData.board?.code, 0),
    Description: description,
    IDAttendant: serviceData.IDAttendant || 0,
    Attendant: serviceData.Attendant || "",
    Supplier: serviceData.supplier?.name || "",
    IDSupplier: serviceData.supplier?.id || 0,
    User: reservation.User || "",
    IDUser: reservation.IDUser || 0,
    Locator: serviceData.connector?.code || "",
    Source: getValidSource(serviceData.source),
    StartLocation: JSON.stringify(serviceData.destination || {}),
    EndLocation: JSON.stringify(serviceData.destination || {}),
    StartDate: formatSafeDate(serviceData.period?.start, now),
    EndDate: formatSafeDate(serviceData.period?.end, expirationDate),
    People: JSON.stringify({ pax: processedPax }),
    Infant: serviceData.pax?.infant || 0,
    Child: serviceData.pax?.child || 0,
    Adult: serviceData.pax?.adult || DEFAULT_PAX_ADULT,
    Senior: serviceData.pax?.senior || 0,
    Information: serviceData.information || "",
    Room: roomInfo,
    BreakType: serviceData.break?.type || "",
    BreakPrice: parseNumber(serviceData.break?.price, 0, true),
    Price: parseNumber(serviceData.price, 0, true),
    Taxes: parseNumber(serviceData.pricing?.taxes?.total, 0, true),
    MarkupInfo: JSON.stringify(serviceData.pricing?.markup || {}),
    TaxesInfo: JSON.stringify(serviceData.pricing?.taxes || {}, null, 0),
    CommissionInfo: JSON.stringify(serviceData.pricing?.commission || {}),
    Commission: parseNumber(
      serviceData.pricing.taxes[0]?.commission?.value || 0,
    ),

    Discount: parseNumber(serviceData.discount, 0, true),
    Rebate: parseNumber(serviceData.rebate, 0, true),
    Cost: parseNumber(serviceData.price, 0, true),
    Bonification: parseNumber(serviceData.bonification, 0, true),
    Extra: parseNumber(serviceData.extra, 0, true),
    Total: parseNumber(serviceData.pricing.taxes[0]?.price?.total || 0),
    Markup: parseNumber(serviceData.pricing.taxes[0]?.markup?.value || 0, true),
    Currency: serviceData.currency || "BRL",
    Exchange: JSON.stringify(serviceData.exchange || {}),
    Options: JSON.stringify(serviceData.options || [], null),
  };

  return baseData;
}

function buildInsertQuery(serviceData) {
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

  return {
    query: `INSERT INTO SERVICE (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values,
  };
}

// ============================================================================
// FUNÇÃO PRINCIPAL
// ============================================================================

export async function createService(
  connection,
  business,
  idmo,
  serviceData,
  paxJsonData = null,
  validationOptions = {},
) {
  try {
    // Validações iniciais
    if (!idmo) {
      return createResponse(false, {}, { code: "E116" });
    }

    validateServiceData(serviceData, validationOptions);

    // Validar reserva
    const reservationResult = await validateReservationExists(
      connection,
      idmo,
      business,
    );
    if (!reservationResult.success) {
      return reservationResult;
    }

    // Verificar duplicatas
    const duplicate = await checkDuplicateService(
      connection,
      serviceData.identifier,
      idmo,
    );
    if (duplicate && !duplicate.error) {
      return createResponse(false, {}, { code: "E128" });
    }
    if (duplicate?.error) {
      return duplicate;
    }

    // Preparar dados (passando o JSON do PAX como parâmetro)
    const preparedData = prepareServiceData(
      serviceData,
      reservationResult.reservation,
      paxJsonData,
    );

    if (!preparedData) {
      return createResponse(false, {});
    }

    // Inserir serviço
    const { query, values } = buildInsertQuery(preparedData);
    const [result] = await connection.query(query, values);

    if (!result.insertId) {
      return createResponse(false, {}, { code: "E127" });
    }

    // Recuperar serviço inserido
    const serviceResult = await getInsertedService(connection, result.insertId);
    if (!serviceResult.success) {
      return serviceResult;
    }

    // Adicionar informações de PAX se disponíveis

    let processedPax = [];
    if (paxJsonData && serviceData.assignedPaxIds) {
      processedPax = processPaxData(serviceData.assignedPaxIds, paxJsonData);
    }

    const responseData = {
      service: serviceResult.service,
      serviceId: result.insertId,
      code: "S121",
      message: messages["S121"] || "Operação realizada com sucesso",
    };

    if (processedPax.length > 0) {
      responseData.paxData = processedPax;
    }

    return createResponse(true, {
      service: serviceResult.service,
      serviceId: result.insertId,
      paxData: processedPax,
      code: "S121",
      message: messages["S121"] || "Operação realizada com sucesso",
    });
  } catch (error) {
    console.error("Erro ao criar serviço:", error);
    return createResponse(false, {}, { code: "E122" });
  }
}

// ============================================================================
// FUNÇÕES ESPECÍFICAS (SIMPLIFICADAS)
// ============================================================================

const createSpecificService =
  (type) =>
  (connection, business, idmo, serviceData, paxJsonData = null) => {
    return createService(
      connection,
      business,
      idmo,
      { ...serviceData, type },
      paxJsonData,
    );
  };

export const createRoomService = createSpecificService(SERVICE_TYPES.ROOM);
export const createTransferService = createSpecificService(
  SERVICE_TYPES.TRANSFER,
);
export const createTicketService = createSpecificService(SERVICE_TYPES.TICKET);
export const createRentalService = createSpecificService(SERVICE_TYPES.RENTAL);
export const createTourService = createSpecificService(SERVICE_TYPES.TOUR);
export const createInsuranceService = createSpecificService(
  SERVICE_TYPES.INSURANCE,
);
export const createFlightService = createSpecificService(SERVICE_TYPES.FLIGHT);
export const createMeetingService = createSpecificService(
  SERVICE_TYPES.MEETING,
);
export const createNoteService = createSpecificService(SERVICE_TYPES.NOTE);
