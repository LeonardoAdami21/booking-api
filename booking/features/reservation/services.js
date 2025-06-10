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

// Cria resposta de erro padronizada
function createErrorResponse(errorCode, customMessage = null) {
  return {
    success: false,
    error: errorCode,
    message: customMessage || messages[errorCode] || "Erro desconhecido",
  };
}

// Cria resposta de sucesso padronizada
function createSuccessResponse(service, serviceId, successCode = "S121") {
  return {
    success: true,
    service,
    serviceId,
    code: successCode,
    message: messages[successCode] || "Operação realizada com sucesso",
  };
  ("");
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

  // Validar identificador
  if (!serviceData.identifier) {
    throw new Error(messages["E115"] || "Identificador é obrigatório");
  }

  // Validar período (se obrigatório)
  if (
    requirePeriod &&
    (!serviceData.period ||
      !serviceData.period.start ||
      !serviceData.period.end)
  ) {
    throw new Error(messages["E123"] || "Período é obrigatório");
  }

  // Validar fornecedor (se obrigatório)
  if (requireSupplier && (!serviceData.supplier || !serviceData.supplier.id)) {
    throw new Error(messages["E124"] || "Fornecedor é obrigatório");
  }

  // Validar ocupação (se obrigatório)
  if (
    requirePax &&
    (!serviceData.pax || (!serviceData.pax.adult && !serviceData.pax.child))
  ) {
    throw new Error(
      messages["E125"] || "Informações de ocupação são obrigatórias",
    );
  }

  // Validar datas se período for fornecido
  if (serviceData.period?.start && serviceData.period?.end) {
    const startDate = createSafeDate(serviceData.period.start);
    const endDate = createSafeDate(serviceData.period.end);

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

  return { valid: true };
}

// ============================================================================
// FUNÇÕES DE BANCO DE DADOS
// ============================================================================
export async function validateReservationExists(connection, idmo, business) {
  try {
    const [result] = await connection.query(
      `SELECT 
        IDMO, Business, Identifier, Hash, Status,
        IDAttendant, Attendant,
        IDUser, User
       FROM \`ORDER\` 
       WHERE IDMO = ? AND Business = ? 
       LIMIT 1`,
      [idmo, business],
    );

    if (result.length === 0) {
      return createErrorResponse("E116");
    }

    const reservation = result[0];

    // Verificar se a reserva está em status válido
    if (reservation.Status === "cancelled") {
      return createErrorResponse("E126");
    }

    return {
      valid: true,
      reservation,
    };
  } catch (error) {
    console.error("Erro na validação da reserva:", error);
    throw new Error(messages["E114"] || "Erro na validação da reserva");
  }
}

// Obtém o serviço inserido pelo ID
export async function getInsertedService(connection, serviceId) {
  try {
    if (!connection || !serviceId) {
      return createErrorResponse(
        "E130",
        "Parâmetros inválidos para busca do serviço",
      );
    }

    const [result] = await connection.query(
      `SELECT IDMOS, IDMO, Identifier, Status, Description, Price, Total, 
              Currency, StartDate, EndDate, Information 
       FROM SERVICE 
       WHERE IDMOS = ? LIMIT 1`,
      [serviceId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return createErrorResponse(
        "E131",
        "Serviço não encontrado após inserção",
      );
    }

    return result[0];
  } catch (error) {
    console.error("Erro ao buscar serviço inserido:", error);
    return createErrorResponse("E127", "Erro ao buscar serviço inserido");
  }
}

// Verifica se o serviço ja foi inserido
export async function checkDuplicateService(connection, identifier, idmo) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMOS, Identifier, Status FROM `SERVICE` WHERE Identifier = ? AND IDMO = ? LIMIT 1",
      [identifier, idmo],
    );
    return existing.length > 0 ? existing[0] : null;
  } catch (error) {
    console.error("Erro ao verificar duplicata:", error);
    return createErrorResponse("E127");
  }
}

export function getServiceInsertQuery(serviceData) {
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
    INSERT INTO SERVICE (${fields.join(", ")})
    VALUES (${placeholders.join(", ")})
  `;

  return { query, values };
}

// ============================================================================
// PREPARAÇÃO DE DADOS
// ============================================================================
export async function prepareServiceData(idmo, serviceData, reservation) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Descrição baseada no tipo de serviço
  let description = serviceData?.room?.category?.value
    ? `${serviceData.room.category.value} com ${serviceData.room.capacity?.value || "capacidade não informada"}`
    : serviceData.description || "Descrição não disponível";

  // Informações do quarto (se aplicável)
  let roomInfo = "";
  if (
    serviceData.room?.capacity?.code &&
    serviceData.room?.category?.code &&
    serviceData.board?.code
  ) {
    roomInfo = `${serviceData.room.capacity.code} - ${serviceData.room.category.code} - ${serviceData.board.code}`;
  } else {
    roomInfo = "Informações do quarto não disponíveis";
  }

  // Exchange rate
  let exchangeRate = "BRL - BRL";
  if (serviceData.exchange?.from && serviceData.exchange?.to) {
    exchangeRate = `${serviceData.exchange.from} - ${serviceData.exchange.to}`;
  }

  return {
    Created: now,
    Updated: now,
    Expiration: createSafeDate(serviceData.expiresAt, expirationDate),
    Confirmation: formatSafeDate(serviceData.confirmation, now),
    IdMO: idmo,
    IDOrder: reservation.Identifier,
    Identifier: serviceData.identifier || "",
    Status: parseIntegerField(serviceData.status),
    Type: serviceData.type || SERVICE_TYPES.ROOM,
    Code: parseIntegerField(serviceData.board?.code, 0),
    Description: description,
    IDAttendant: reservation.IDAttendant || 0,
    Attendant: reservation.Attendant || "",
    Supplier: serviceData.supplier?.name || "",
    IDSupplier: serviceData.supplier?.id || 0,
    User: reservation.User || "",
    IDUser: reservation.IDUser || 0,
    Locator: serviceData.connector?.code || "",
    StartLocation: serviceData.destination?.name || "",
    EndLocation: serviceData.destination?.name || "",
    StartDate: formatSafeDate(serviceData.period?.start, now),
    EndDate: formatSafeDate(serviceData.period?.end, expirationDate),
    People: JSON.stringify(serviceData.pax || {}),
    Infant: serviceData.pax?.infant || 0,
    Child: serviceData.pax?.child || 0,
    Adult: serviceData.pax?.adult || DEFAULT_PAX_ADULT,
    Senior: serviceData.pax?.senior || 0,
    Information: serviceData.information || "",
    Room: roomInfo,
    BreakType: serviceData.break?.type || "",
    BreakPrice: parseFloatField(serviceData.break?.price),
    Price: parseFloatField(serviceData.price),
    Taxes: parseFloatField(serviceData?.pricing?.taxes?.total),
    MarkupInfo: parseFloatField(serviceData.pricing?.markup?.total),
    TaxesInfo: parseFloatField(serviceData?.pricing?.taxes?.total),
    CommissionInfo: parseFloatField(serviceData?.pricing?.commission?.total),
    Discount: parseFloatField(0),
    Rebate: parseFloatField(0),
    Cost: parseFloatField(serviceData.price),
    Bonification: parseFloatField(serviceData.bonification),
    Extra: parseFloatField(serviceData.extra),
    Total: parseFloatField(serviceData.total || serviceData.price),
    PriceSource: parseFloatField(serviceData.price_source),
    Currency: serviceData.currency || "BRL",
    Exchange: exchangeRate,
  };
}

// ============================================================================
// FUNÇÃO PRINCIPAL GENÉRICA
// ============================================================================

export async function createService(
  connection,
  business,
  idmo,
  serviceData,
  validationOptions = {},
) {
  try {
    // Validar IDMO
    if (idmo == null) {
      return createErrorResponse("E116");
    }

    // 1. Validar se a reserva existe
    const reservationValidation = await validateReservationExists(
      connection,
      idmo,
      business,
    );
    if (!reservationValidation.valid) {
      return reservationValidation;
    }

    // 2. Validar dados do serviço
    try {
      validateServiceData(serviceData, validationOptions);
    } catch (validationError) {
      return createErrorResponse("E117", validationError.message);
    }

    // 3. Verificar duplicata
    const duplicate = await checkDuplicateService(
      connection,
      serviceData.identifier,
      idmo,
    );
    if (duplicate && !duplicate.error) {
      return createErrorResponse("E128");
    }
    if (duplicate?.error) {
      return duplicate;
    }

    // 4. Preparar dados para inserção
    const preparedData = await prepareServiceData(
      idmo,
      serviceData,
      reservationValidation.reservation,
    );

    // 5. Validação crítica do IDMO
    if (!preparedData.IdMO) {
      return createErrorResponse(
        "E132",
        "IDMO é obrigatório e não pode ser null ou zero",
      );
    }

    // 6. Inserir serviço
    const { query: insertQuery, values } = getServiceInsertQuery(preparedData);
    const [result] = await connection.query(insertQuery, values);

    if (!result.insertId) {
      return createErrorResponse("E127");
    }

    // 7. Recuperar serviço inserido
    const insertedService = await getInsertedService(
      connection,
      result.insertId,
    );
    if (insertedService.error) {
      return insertedService;
    }

    return createSuccessResponse(insertedService, result.insertId);
  } catch (error) {
    console.error("Erro ao criar serviço:", error);
    return createErrorResponse("E122");
  }
}

// ============================================================================
// FUNÇÕES ESPECÍFICAS POR TIPO DE SERVIÇO
// ============================================================================

/**
 * Cria serviço de quarto
 */
export async function createRoomService(connection, business, idmo, room) {
  return createService(connection, business, idmo, {
    ...room,
    type: SERVICE_TYPES.ROOM,
  });
}

/**
 * Cria serviço de tour
 */
export async function createTourService(connection, business, idmo, tour) {
  return createService(connection, business, idmo, {
    ...tour,
    type: SERVICE_TYPES.TOUR,
  });
}

/**
 * Cria serviço de transfer
 */
export async function createTransferService(
  connection,
  business,
  idmo,
  transfer,
) {
  return createService(connection, business, idmo, {
    ...transfer,
    type: SERVICE_TYPES.TRANSFER,
  });
}

/**
 * Cria serviço de ticket
 */
export async function createTicketService(connection, business, idmo, ticket) {
  return createService(connection, business, idmo, {
    ...ticket,
    type: SERVICE_TYPES.TICKET,
  });
}

/**
 * Cria serviço de seguro
 */
export async function createInsuranceService(
  connection,
  business,
  idmo,
  insurance,
) {
  return createService(connection, business, idmo, {
    ...insurance,
    type: SERVICE_TYPES.INSURANCE,
  });
}

/**
 * Cria serviço de voo
 */
export async function createFlightService(connection, business, idmo, flight) {
  return createService(connection, business, idmo, {
    ...flight,
    type: SERVICE_TYPES.FLIGHT,
  });
}

/**
 * Cria serviço de aluguel
 */
export async function createRentalService(connection, business, idmo, rental) {
  return createService(connection, business, idmo, {
    ...rental,
    type: SERVICE_TYPES.RENTAL,
  });
}

// Cria serviço de nota
export async function createNoteService(connection, business, idmo, note) {
  console.log("Creating note service with data:", note);

  // Mapear os dados do note para o formato esperado pelo createService
  const mappedNoteData = {
    createdAt: formatSafeDate(note.createdAt),
    updatedAt: formatSafeDate(note.updatedAt),
    rememberAt: formatSafeDate(note.rememberAt),
    identifier: note.id || note.identifier,
    type: SERVICE_TYPES.NOTE,
    description: note.title || note.description || "Nota sem título",
    information: note.description || note.information || "",
    status: note.status === "active" ? 1 : 0,
    // Para notes, usamos rememberAt como data de início se disponível
    // Dados extras específicos do note
    extra_data: JSON.stringify({
      title: note.title,
      tags: note.tags || [],
      visibility: note.visibility || "private",
      parent: note.parent,
      parentType: note.parentType,
      rememberAt: note.rememberAt,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }),
  };

  const result = await createService(
    connection,
    business,
    idmo,
    mappedNoteData,
    {
      requirePeriod: false,
      requireSupplier: false,
      requirePax: false,
    },
  );

  return result;
}

/**
 * Cria serviço de reunião com estrutura específica
 */
export async function createMeetingService(
  connection,
  business,
  idmo,
  meeting,
) {
  console.log("Creating meeting service with data:", meeting);

  // Mapear os dados do meeting para o formato esperado pelo createService
  const mappedMeetingData = {
    identifier: meeting.id || meeting.identifier,
    type: SERVICE_TYPES.MEETING,
    description: meeting.title || meeting.description || "Reunião sem título",
    information: meeting.description || meeting.information || "",
    status:
      meeting.status === "pending" ? 0 : meeting.status === "active" ? 1 : 0,

    // Período da reunião
    period: meeting.period
      ? {
          start: meeting.period.start,
          end: meeting.period.end,
        }
      : undefined,

    // Destino/localização da reunião
    destination: meeting.destination
      ? {
          name: meeting.destination.name,
          city: meeting.destination.city,
          state: meeting.destination.state,
          country: meeting.destination.country,
          coordinates: meeting.destination.coordinates,
        }
      : undefined,

    // Dados extras específicos do meeting
    extra_data: JSON.stringify({
      title: meeting.title,
      tags: meeting.tags || [],
      visibility: meeting.visibility || "private",
      parent: meeting.parent,
      parentType: meeting.parentType,
      rememberAt: meeting.rememberAt,
      destination: meeting.destination,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    }),
  };

  return createService(connection, business, idmo, mappedMeetingData, {
    requireSupplier: false,
    requirePax: false,
    requirePeriod: true, // Meeting precisa de período
  });
}

// ============================================================================
// FUNÇÃO AUXILIAR PARA PREPARAR DADOS ESPECÍFICOS
// ============================================================================

/**
 * Prepara dados específicos para serviços de note e meeting
 */
export async function prepareSpecialServiceData(
  idmo,
  serviceData,
  reservation,
  serviceType,
) {
  const baseData = await prepareServiceData(idmo, serviceData, reservation);

  // Ajustes específicos baseados no tipo
  if (serviceType === SERVICE_TYPES.NOTE) {
    return {
      ...baseData,
      // Para notes, ajustar campos específicos
      Description: serviceData.title || serviceData.description || "Nota",
      Information: serviceData.description || serviceData.information || "",
      StartDate: serviceData.rememberAt
        ? formatSafeDate(serviceData.rememberAt)
        : baseData.StartDate,
      EndDate: serviceData.rememberAt
        ? formatSafeDate(serviceData.rememberAt)
        : baseData.EndDate,
      // Adicionar dados extras como JSON
      ExtraData: serviceData.extra_data || null,
    };
  }

  if (serviceType === SERVICE_TYPES.MEETING) {
    return {
      ...baseData,
      // Para meetings, usar dados de localização
      Description: serviceData.title || serviceData.description || "Reunião",
      Information: serviceData.description || serviceData.information || "",
      StartLocation: serviceData.destination?.name || baseData.StartLocation,
      EndLocation: serviceData.destination?.name || baseData.EndLocation,
      // Adicionar dados extras como JSON
      ExtraData: serviceData.extra_data || null,
    };
  }

  return baseData;
}

// ============================================================================
// VALIDAÇÕES ESPECÍFICAS ATUALIZADAS
// ============================================================================


// ============================================================================
// FUNÇÕES LEGADAS (MANTIDAS PARA COMPATIBILIDADE)
// ============================================================================

// Mantendo as funções originais como wrapper para a nova implementação
export const validateRoomService = (room) => validateServiceData(room);
export const validateTransferService = (transfer) =>
  validateServiceData(transfer);
export const validateTicketService = (ticket) => validateServiceData(ticket);
export const validateInsuranceService = (insurance) =>
  validateServiceData(insurance);
export const validateFlightService = (flight) => validateServiceData(flight);
export const validateRentalService = (rental) => validateServiceData(rental);
export const validateNoteService = (note) =>
  validateServiceData(note, {
    requirePeriod: false,
    requireSupplier: false,
    requirePax: false,
  });
export const validateMeetingService = (meeting) =>
  validateServiceData(meeting, { requireSupplier: false, requirePax: false });

// Função legada mantida para compatibilidade
export const allServicesData = prepareServiceData;
