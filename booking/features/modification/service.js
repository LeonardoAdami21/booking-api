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
function createSuccessResponse(service, serviceId, successCode = "S122") {
  return {
    success: true,
    service,
    serviceId,
    code: successCode,
    message:
      messages[successCode] || "Operação de atualização realizada com sucesso",
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
// FUNÇÕES DE BANCO DE DADOS - RESERVATION
// ============================================================================

// Função para obter a query de atualização de uma reserva
export function getReservationUpdateQuery(serviceData, whereConditions = {}) {
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

// Validar se a reserva existe e pode ser atualizada
export async function validateReservationForUpdate(connection, idmo, business) {
  try {
    const [result] = await connection.query(
      `SELECT 
        IDMO, Business, Identifier, Hash, Status,
        IDAttendant, Attendant,
        IDUser, User, Version
       FROM \`ORDER\` 
       WHERE IDMO = ? AND Business = ? 
       LIMIT 1`,
      [idmo, business],
    );

    if (result.length === 0) {
      return createErrorResponse("E116");
    }

    const reservation = result[0];

    // Verificar se a reserva está em status válido para atualização
    if (reservation.Status === "cancelled") {
      return createErrorResponse("E126");
    }

    return {
      valid: true,
      reservation,
    };
  } catch (error) {
    console.error("Erro na validação da reserva para atualização:", error);
    throw new Error(messages["E114"] || "Erro na validação da reserva");
  }
}

// Função para obter o nome completo
export function getFullName(person) {
  if (!person) return "";
  const firstName = person.firstName || "";
  const lastName = person.lastName || "";
  return `${firstName} ${lastName}`.trim();
}

// Função para preparar os dados da reserva para atualização
export function prepareReservationUpdateData(reservation) {
  const now = new Date();

  const data = {
    Updated: now,
    Expiration: reservation.expiresAt ? new Date(reservation.expiresAt) : null,
    Confirmation: reservation.confirmation
      ? new Date(reservation.confirmation)
      : null,
    Language: reservation.language,
    Status: reservation.status,
    Type: reservation.type,
    StartDate: reservation.period?.start
      ? new Date(reservation.period.start)
      : null,
    EndDate: reservation.period?.end ? new Date(reservation.period.end) : null,
    Channel: reservation.channel?.name,
    Locator: reservation.locator,

    // Company data
    IDCompany: reservation.company?.id,
    Company: reservation.company?.name,

    // Client data
    IDClient: reservation.client?.id,
    Client: reservation.client?.name,

    // Agent data
    IDAgente: reservation.agent?.id,
    Agente: reservation.agent ? getFullName(reservation.agent) : null,

    // Attendant data
    IDAttendant: reservation.attendant?.id,
    Attendant: reservation.attendant
      ? getFullName(reservation.attendant)
      : null,

    // User data
    IDUser: reservation.user?.id,
    User: reservation.user ? getFullName(reservation.user) : null,

    // Customer data
    IDCustomer: reservation.customer?.id,
    Customer: reservation.customer ? getFullName(reservation.customer) : null,

    // Financial
    Price: reservation.total?.service?.price,
    Discount: reservation.total?.service?.discount,
    Taxes: reservation.total?.service?.tax,
    Markup: reservation.total?.service?.markup,
    Commission: reservation.total?.service?.commission,
    Cost: reservation.total?.service?.price,
    Rav: reservation.total?.service?.price,
    Total: reservation.total?.total,

    // Extra info
    Information: reservation.information,
    Notes: reservation.notes,
  };

  // Remove campos undefined/null para não sobrescrever dados existentes
  const cleanData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) {
      cleanData[key] = value;
    }
  }

  return cleanData;
}

// ============================================================================
// FUNÇÕES DE BANCO DE DADOS - SERVICES
// ============================================================================

// Validar se o serviço existe e pode ser atualizado
export async function validateServiceForUpdate(connection, serviceId, idmo) {
  try {
    const [result] = await connection.query(
      `SELECT 
        IDMOS, IDMO, Identifier, Status, Type
       FROM SERVICE 
       WHERE IDMOS = ? AND IDMO = ? 
       LIMIT 1`,
      [serviceId, idmo],
    );

    if (result.length === 0) {
      return createErrorResponse("E131", "Serviço não encontrado");
    }

    const service = result[0];

    return {
      valid: true,
      service,
    };
  } catch (error) {
    console.error("Erro na validação do serviço para atualização:", error);
    throw new Error("Erro na validação do serviço");
  }
}

// Obter query de atualização de serviço
export function getServiceUpdateQuery(serviceData, whereConditions = {}) {
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
    UPDATE SERVICE 
    SET ${fields.join(", ")}
    WHERE ${whereFields.join(" AND ")}
  `;

  return {
    query,
    values: [...values, ...whereValues],
  };
}

// Obtém o serviço atualizado pelo ID
export async function getUpdatedService(connection, serviceId) {
  try {
    if (!connection || !serviceId) {
      return createErrorResponse(
        "E130",
        "Parâmetros inválidos para busca do serviço",
      );
    }

    const [result] = await connection.query(
      `SELECT IDMOS, IDMO, Identifier, Status, Description, Price, Total, 
              Currency, StartDate, EndDate, Information, Updated
       FROM SERVICE 
       WHERE IDMOS = ? LIMIT 1`,
      [serviceId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return createErrorResponse(
        "E131",
        "Serviço não encontrado após atualização",
      );
    }

    return result[0];
  } catch (error) {
    console.error("Erro ao buscar serviço atualizado:", error);
    return createErrorResponse("E127", "Erro ao buscar serviço atualizado");
  }
}

// ============================================================================
// PREPARAÇÃO DE DADOS PARA ATUALIZAÇÃO
// ============================================================================
export async function prepareServiceUpdateData(serviceData, existingService) {
  const now = new Date();

  // Descrição baseada no tipo de serviço
  let description = serviceData?.room?.category?.value
    ? `${serviceData.room.category.value} com ${serviceData.room.capacity?.value || "capacidade não informada"}`
    : serviceData.description;

  // Informações do quarto (se aplicável)
  let roomInfo = "";
  if (
    serviceData.room?.capacity?.code &&
    serviceData.room?.category?.code &&
    serviceData.board?.code
  ) {
    roomInfo = `${serviceData.room.capacity.code} - ${serviceData.room.category.code} - ${serviceData.board.code}`;
  }

  // Exchange rate
  let exchangeRate = null;
  if (serviceData.exchange?.from && serviceData.exchange?.to) {
    exchangeRate = `${serviceData.exchange.from} - ${serviceData.exchange.to}`;
  }

  const updateData = {
    Updated: now,
    Expiration: serviceData.expiresAt
      ? createSafeDate(serviceData.expiresAt)
      : null,
    Confirmation: serviceData.confirmation
      ? formatSafeDate(serviceData.confirmation)
      : null,
    Status:
      serviceData.status !== undefined
        ? parseIntegerField(serviceData.status)
        : null,
    Code: serviceData.board?.code
      ? parseIntegerField(serviceData.board.code)
      : null,
    Description: description,
    Supplier: serviceData.supplier?.name,
    IDSupplier: serviceData.supplier?.id,
    Locator: serviceData.connector?.code,
    StartLocation: serviceData.destination?.name,
    EndLocation: serviceData.destination?.name,
    StartDate: serviceData.period?.start
      ? formatSafeDate(serviceData.period.start)
      : null,
    EndDate: serviceData.period?.end
      ? formatSafeDate(serviceData.period.end)
      : null,
    People: serviceData.pax ? JSON.stringify(serviceData.pax) : null,
    Infant: serviceData.pax?.infant,
    Child: serviceData.pax?.child,
    Adult: serviceData.pax?.adult,
    Senior: serviceData.pax?.senior,
    Information: serviceData.information,
    Room: roomInfo || null,
    BreakType: serviceData.break?.type,
    BreakPrice: serviceData.break?.price
      ? parseFloatField(serviceData.break.price)
      : null,
    Price: serviceData.price ? parseFloatField(serviceData.price) : null,
    Taxes: serviceData?.pricing?.taxes?.total
      ? parseFloatField(serviceData.pricing.taxes.total)
      : null,
    MarkupInfo: serviceData.pricing?.markup?.total
      ? parseFloatField(serviceData.pricing.markup.total)
      : null,
    TaxesInfo: serviceData?.pricing?.taxes?.total
      ? parseFloatField(serviceData.pricing.taxes.total)
      : null,
    CommissionInfo: serviceData?.pricing?.commission?.total
      ? parseFloatField(serviceData.pricing.commission.total)
      : null,
    Discount: serviceData.discount
      ? parseFloatField(serviceData.discount)
      : null,
    Rebate: serviceData.rebate ? parseFloatField(serviceData.rebate) : null,
    Cost: serviceData.price ? parseFloatField(serviceData.price) : null,
    Bonification: serviceData.bonification
      ? parseFloatField(serviceData.bonification)
      : null,
    Extra: serviceData.extra ? parseFloatField(serviceData.extra) : null,
    Total: serviceData.total
      ? parseFloatField(serviceData.total)
      : serviceData.price
        ? parseFloatField(serviceData.price)
        : null,
    PriceSource: serviceData.price_source
      ? parseFloatField(serviceData.price_source)
      : null,
    Currency: serviceData.currency,
    Exchange: exchangeRate,
  };

  // Remove campos null/undefined para não sobrescrever dados existentes
  const cleanData = {};
  for (const [key, value] of Object.entries(updateData)) {
    if (value !== null && value !== undefined) {
      cleanData[key] = value;
    }
  }

  return cleanData;
}

// ============================================================================
// FUNÇÃO PRINCIPAL DE ATUALIZAÇÃO DE RESERVA
// ============================================================================

export async function updateReservation(
  connection,
  business,
  idmo,
  reservationData,
) {
  try {
    // Validar IDMO
    if (idmo == null) {
      return createErrorResponse("E116");
    }

    // 1. Validar se a reserva existe e pode ser atualizada
    const reservationValidation = await validateReservationForUpdate(
      connection,
      idmo,
      business,
    );
    if (!reservationValidation.valid) {
      return reservationValidation;
    }

    // 2. Preparar dados para atualização
    const updateData = prepareReservationUpdateData(reservationData);

    // 3. Verificar se há dados para atualizar
    if (Object.keys(updateData).length === 0) {
      return createErrorResponse(
        "E133",
        "Nenhum dado para atualizar foi fornecido",
      );
    }

    // 4. Atualizar reserva
    const whereConditions = {
      IDMO: idmo,
      Business: business,
    };

    const { query: updateQuery, values } = getReservationUpdateQuery(
      updateData,
      whereConditions,
    );
    const [result] = await connection.query(updateQuery, values);

    if (result.affectedRows === 0) {
      return createErrorResponse("E134", "Nenhuma reserva foi atualizada");
    }

    // 5. Recuperar reserva atualizada
    const [updatedReservation] = await connection.query(
      "SELECT IDMO, Business, Identifier, Hash, Version, Updated FROM `ORDER` WHERE IDMO = ? AND Business = ? LIMIT 1",
      [idmo, business],
    );

    if (updatedReservation.length === 0) {
      return createErrorResponse(
        "E135",
        "Erro ao recuperar reserva atualizada",
      );
    }

    return createSuccessResponse(updatedReservation[0], idmo, "S123");
  } catch (error) {
    console.error("Erro ao atualizar reserva:", error);
    return createErrorResponse("E136", "Erro interno ao atualizar reserva");
  }
}

// ============================================================================
// FUNÇÃO PRINCIPAL GENÉRICA DE ATUALIZAÇÃO DE SERVIÇO
// ============================================================================

export async function updateService(
  connection,
  business,
  idmo,
  serviceId,
  serviceData,
  validationOptions = {},
) {
  try {
    // Validar parâmetros
    if (idmo == null || serviceId == null) {
      return createErrorResponse(
        "E137",
        "IDMO e ID do serviço são obrigatórios",
      );
    }

    // 1. Validar se a reserva existe
    const reservationValidation = await validateReservationForUpdate(
      connection,
      idmo,
      business,
    );
    if (!reservationValidation.valid) {
      return reservationValidation;
    }

    // 2. Validar se o serviço existe e pode ser atualizado
    const serviceValidation = await validateServiceForUpdate(
      connection,
      serviceId,
      idmo,
    );
    if (!serviceValidation.valid) {
      return serviceValidation;
    }

    // 3. Validar dados do serviço (opcional)
    if (Object.keys(serviceData).length > 1) {
      // Mais que apenas o identifier
      try {
        validateServiceData(serviceData, validationOptions);
      } catch (validationError) {
        return createErrorResponse("E117", validationError.message);
      }
    }

    // 4. Preparar dados para atualização
    const updateData = await prepareServiceUpdateData(
      serviceData,
      serviceValidation.service,
    );

    // 5. Verificar se há dados para atualizar
    if (Object.keys(updateData).length === 0) {
      return createErrorResponse(
        "E138",
        "Nenhum dado para atualizar foi fornecido",
      );
    }

    // 6. Atualizar serviço
    const whereConditions = {
      IDMOS: serviceId,
      IDMO: idmo,
    };

    const { query: updateQuery, values } = getServiceUpdateQuery(
      updateData,
      whereConditions,
    );
    const [result] = await connection.query(updateQuery, values);

    if (result.affectedRows === 0) {
      return createErrorResponse("E139", "Nenhum serviço foi atualizado");
    }

    // 7. Recuperar serviço atualizado
    const updatedService = await getUpdatedService(connection, serviceId);
    if (updatedService.error) {
      return updatedService;
    }

    return createSuccessResponse(updatedService, serviceId);
  } catch (error) {
    console.error("Erro ao atualizar serviço:", error);
    return createErrorResponse("E140", "Erro interno ao atualizar serviço");
  }
}

// ============================================================================
// FUNÇÕES ESPECÍFICAS POR TIPO DE SERVIÇO
// ============================================================================

/**
 * Atualiza serviço de quarto
 */
export async function updateRoomService(
  connection,
  business,
  idmo,
  serviceId,
  room,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...room,
    type: SERVICE_TYPES.ROOM,
  });
}

/**
 * Atualiza serviço de tour
 */
export async function updateTourService(
  connection,
  business,
  idmo,
  serviceId,
  tour,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...tour,
    type: SERVICE_TYPES.TOUR,
  });
}

/**
 * Atualiza serviço de transfer
 */
export async function updateTransferService(
  connection,
  business,
  idmo,
  serviceId,
  transfer,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...transfer,
    type: SERVICE_TYPES.TRANSFER,
  });
}

/**
 * Atualiza serviço de ticket
 */
export async function updateTicketService(
  connection,
  business,
  idmo,
  serviceId,
  ticket,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...ticket,
    type: SERVICE_TYPES.TICKET,
  });
}

/**
 * Atualiza serviço de seguro
 */
export async function updateInsuranceService(
  connection,
  business,
  idmo,
  serviceId,
  insurance,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...insurance,
    type: SERVICE_TYPES.INSURANCE,
  });
}

/**
 * Atualiza serviço de voo
 */
export async function updateFlightService(
  connection,
  business,
  idmo,
  serviceId,
  flight,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...flight,
    type: SERVICE_TYPES.FLIGHT,
  });
}

/**
 * Atualiza serviço de aluguel
 */
export async function updateRentalService(
  connection,
  business,
  idmo,
  serviceId,
  rental,
) {
  return updateService(connection, business, idmo, serviceId, {
    ...rental,
    type: SERVICE_TYPES.RENTAL,
  });
}

/**
 * Atualiza serviço de nota
 */
export async function updateNoteService(
  connection,
  business,
  idmo,
  serviceId,
  note,
) {
  console.log("Updating note service with data:", note);

  // Mapear os dados do note para o formato esperado pelo updateService
  const mappedNoteData = {
    identifier: note.id || note.identifier,
    type: SERVICE_TYPES.NOTE,
    description: note.title || note.description,
    information: note.description || note.information,
    status: note.status === "active" ? 1 : 0,
    // Para notes, usamos rememberAt como data de início se disponível
    period: note.rememberAt
      ? {
          start: note.rememberAt,
          end: note.rememberAt,
        }
      : undefined,
    // Dados extras específicos do note
    extra_data: JSON.stringify({
      title: note.title,
      tags: note.tags || [],
      visibility: note.visibility || "private",
      parent: note.parent,
      parentType: note.parentType,
      rememberAt: note.rememberAt,
      updatedAt: note.updatedAt,
    }),
  };

  return updateService(connection, business, idmo, serviceId, mappedNoteData, {
    requirePeriod: false,
    requireSupplier: false,
    requirePax: false,
  });
}

/**
 * Atualiza serviço de reunião
 */
export async function updateMeetingService(
  connection,
  business,
  idmo,
  serviceId,
  meeting,
) {
  console.log("Updating meeting service with data:", meeting);

  // Mapear os dados do meeting para o formato esperado pelo updateService
  const mappedMeetingData = {
    identifier: meeting.id || meeting.identifier,
    type: SERVICE_TYPES.MEETING,
    description: meeting.title || meeting.description,
    information: meeting.description || meeting.information,
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
      updatedAt: meeting.updatedAt,
    }),
  };

  return updateService(
    connection,
    business,
    idmo,
    serviceId,
    mappedMeetingData,
    {
      requireSupplier: false,
      requirePax: false,
      requirePeriod: false, // Tornando opcional para update
    },
  );
}

// ============================================================================
// FUNÇÕES LEGADAS (MANTIDAS PARA COMPATIBILIDADE)
// ============================================================================

// Mantendo as funções originais como wrapper para a nova implementação
export const validateRoomServiceUpdate = (room) => validateServiceData(room);
export const validateTransferServiceUpdate = (transfer) =>
  validateServiceData(transfer);
export const validateTicketServiceUpdate = (ticket) =>
  validateServiceData(ticket);
export const validateInsuranceServiceUpdate = (insurance) =>
  validateServiceData(insurance);
export const validateFlightServiceUpdate = (flight) =>
  validateServiceData(flight);
export const validateRentalServiceUpdate = (rental) =>
  validateServiceData(rental);
export const validateNoteServiceUpdate = (note) =>
  validateServiceData(note, {
    requirePeriod: false,
    requireSupplier: false,
    requirePax: false,
  });
export const validateMeetingServiceUpdate = (meeting) =>
  validateServiceData(meeting, { requireSupplier: false, requirePax: false });

// Função legada mantida para compatibilidade
export const allServicesUpdateData = prepareServiceUpdateData;

export function generateHash() {
  return uuidv4().replace(/-/g, "");
}
