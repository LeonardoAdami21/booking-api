import { loadErrorMessages } from "../../index.js";

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
      `SELECT IDMO, Business, Identifier, Hash, Status, IDAttendant, Attendant, 
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
              Currency, StartDate, EndDate, Information, People
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

function processPaxData(assignedPaxIds, paxJsonData) {
  if (!paxJsonData || !assignedPaxIds) {
    return { paxData: [], paxInfo: {} };
  }

  const assignedIds = Array.isArray(assignedPaxIds)
    ? assignedPaxIds
    : [assignedPaxIds];
  const paxData = [];
  const paxInfo = {};

  // Processar cada PAX atribuído do JSON externo
  assignedIds.forEach((paxId) => {
    const paxDetails = paxJsonData[paxId];
    if (paxDetails) {
      const processedPax = {
        id: paxId,
        main: paxDetails.main || false,
        firstName: paxDetails.firstName || "",
        lastName: paxDetails.lastName || "",
        phone: paxDetails.phone || "",
        email: paxDetails.email || "",
        country: paxDetails.country || "",
        document: {
          type: paxDetails.document?.type || "",
          number: paxDetails.document?.number || "",
        },
        birthdate: paxDetails.birthdate || "",
        gender: paxDetails.gender || "",
        ageGroup: paxDetails.ageGroup || "",
        assignment: paxDetails.assignment || {},
      };

      paxData.push(processedPax);
      paxInfo[paxId] = processedPax;
    }
  });

  return { paxData, paxInfo };
}

// ============================================================================
// PREPARAÇÃO DE DADOS DO SERVIÇO
// ============================================================================

function prepareServiceData(
  idmo,
  serviceData,
  reservation,
  paxJsonData = null,
) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Processar dados do PAX vindos do JSON externo
  const { paxData } = processPaxData(serviceData.assigned, paxJsonData);

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
    IdMO: idmo,
    IDOrder: reservation.IDMO,
    Identifier: serviceData.identifier || "",
    Status: parseNumber(serviceData.status, 0),
    Type: serviceData.type || SERVICE_TYPES.ROOM,
    Code: parseNumber(serviceData.board?.code, 0),
    Description: description,
    IDAttendant: reservation.IDAttendant || 0,
    Attendant: reservation.Attendant || "",
    Supplier: serviceData.supplier?.name || "",
    IDSupplier: serviceData.supplier?.id || 0,
    User: reservation.User || "",
    IDUser: reservation.IDUser || 0,
    Locator: serviceData.connector?.code || "",
    StartLocation: JSON.stringify(serviceData.destination || {}),
    EndLocation: JSON.stringify(serviceData.destination || {}),
    StartDate: formatSafeDate(serviceData.period?.start, now),
    EndDate: formatSafeDate(serviceData.period?.end, expirationDate),
    People: JSON.stringify({ pax: paxData }),
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
    TaxesInfo: JSON.stringify(serviceData.pricing?.taxes || {}),
    CommissionInfo: JSON.stringify(serviceData.pricing?.commission || {}),
    Discount: parseNumber(serviceData.discount, 0, true),
    Rebate: parseNumber(serviceData.rebate, 0, true),
    Cost: parseNumber(serviceData.price, 0, true),
    Bonification: parseNumber(serviceData.bonification, 0, true),
    Extra: parseNumber(serviceData.extra, 0, true),
    Total: parseNumber(serviceData.total || serviceData.price, 0, true),
    PriceSource: parseNumber(serviceData.price_source, 0, true),
    Currency: serviceData.currency || "BRL",
    Exchange: JSON.stringify(serviceData.exchange || {}),
  };

  // Ajustes específicos por tipo de serviço
  if (serviceData.type === SERVICE_TYPES.NOTE) {
    baseData.StartDate = serviceData.rememberAt
      ? formatSafeDate(serviceData.rememberAt)
      : baseData.StartDate;
    baseData.EndDate = baseData.StartDate;
    baseData.ExtraData = JSON.stringify(serviceData.extra_data || {});
  }

  if (serviceData.type === SERVICE_TYPES.MEETING) {
    baseData.StartLocation =
      serviceData.destination?.name || baseData.StartLocation;
    baseData.EndLocation =
      serviceData.destination?.name || baseData.EndLocation;
    baseData.ExtraData = JSON.stringify(serviceData.extra_data || {});
  }

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
      idmo,
      serviceData,
      reservationResult.reservation,
      paxJsonData,
    );

    if (!preparedData.IdMO) {
      return createResponse(
        false,
        {},
        { code: "E132", message: "IDMO é obrigatório" },
      );
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
    const { paxInfo } = processPaxData(serviceData.assigned, paxJsonData);

    return createResponse(true, {
      service: serviceResult.service,
      serviceId: result.insertId,
      paxData: Object.keys(paxInfo).length > 0 ? paxInfo : null,
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
