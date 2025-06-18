import { loadErrorMessages } from "../../index.js";
import {
  createTransferServiceWithStopovers,
  insertAllStopovers,
} from "./transfer.js";
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
// NOVA FUNÇÃO PARA EXTRAIR SERVIÇOS DA NOVA ESTRUTURA JSON
// ============================================================================

function extractServicesFromBooking(bookingData) {
  const extractedServices = [];

  if (!bookingData?.service) {
    return extractedServices;
  }

  const serviceTypes = bookingData.service;

  // Iterar por cada tipo de serviço (room, transfer, ticket, etc.)
  Object.keys(serviceTypes).forEach((serviceType) => {
    const servicesArray = serviceTypes[serviceType];

    // Verificar se é um array
    if (Array.isArray(servicesArray)) {
      servicesArray.forEach((serviceItem, index) => {
        extractedServices.push({
          ...serviceItem,
          type: serviceType, // Adicionar o tipo do serviço
          originalIndex: index, // Manter referência do índice original
          serviceGroup: serviceType, // Para referência futura
        });
      });
    }
  });

  return extractedServices;
}

// ============================================================================
// FUNÇÃO PARA BUSCAR SERVIÇO ESPECÍFICO POR TIPO E ÍNDICE
// ============================================================================

function getServiceByTypeAndIndex(bookingData, serviceType, index = 0) {
  if (!bookingData?.service?.[serviceType]) {
    return null;
  }

  const servicesArray = bookingData.service[serviceType];

  if (!Array.isArray(servicesArray) || servicesArray.length <= index) {
    return null;
  }

  return {
    ...servicesArray[index],
    type: serviceType,
    originalIndex: index,
    serviceGroup: serviceType,
  };
}

// ============================================================================
// VALIDAÇÕES ATUALIZADAS
// ============================================================================

function validateServiceData(serviceData, options = {}) {
  const {
    requireIdentifier = true,
    requirePeriod = true,
    requireSupplier = false,
    requirePax = false,
  } = options;

  if (requireIdentifier && !serviceData.identifier) {
    throw new Error(messages["E115"] || "Identificador é obrigatório");
  }

  if (requirePeriod && (!serviceData?.checkin || !serviceData?.checkout)) {
    throw new Error(messages["E123"] || "Período é obrigatório");
  }

  if (requirePax && !serviceData.pax?.adult && !serviceData.pax?.child) {
    throw new Error(
      messages["E125"] || "Informações de ocupação são obrigatórias",
    );
  }

  // Validar datas se período for fornecido
  if (serviceData?.checkin && serviceData?.checkout) {
    const startDate = createSafeDate(serviceData.checkin);
    const endDate = createSafeDate(serviceData.checkout);

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

export async function validateBookingExists(connection, channel) {
  try {
    const [result] = await connection.query(
      `SELECT Channel, Identifier, Status, IDIssuer, Issuer, 
              IDUser, User, IDMO
       FROM \`ORDER\`
       WHERE Channel = ?
       LIMIT 1`,
      [channel],
    );

    if (result.length === 0) {
      return createResponse(false, {}, { code: "E116" });
    }

    const booking = result[0];

    if (booking.Status === "cancelled") {
      return createResponse(false, {}, { code: "E126" });
    }

    return createResponse(true, { booking });
  } catch (error) {
    throw new Error(messages["E114"] || "Erro na validação da reserva");
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
      `SELECT IDMOS, IDMO, Identifier, Status, Title, Price, Total, Fee,
              Currency, CheckIn, CheckOut, Information, People, Source, Options
       FROM SERVICE 
       WHERE IDMOS = ? LIMIT 1`,
      [serviceId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return createResponse(false, {}, { code: "E131" });
    }

    return createResponse(true, { service: result[0] });
  } catch (error) {
    return createResponse(false, {}, { code: "E127" });
  }
}

// Funções auxiliares
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
    .filter(Boolean);
}

function formatPaxData(pax) {
  return {
    id: pax.id || pax.paxId,
    main: pax.main || false,
    firstName: pax.firstName,
    lastName: pax.lastName,
    phone: pax.phone,
    email: pax.email,
    country: pax.country,
    document: pax.document,
    birthdate: pax.birthdate,
    gender: pax.gender,
    ageGroup: pax.ageGroup,
  };
}

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
  if (!sourceValue) {
    return DEFAULT_SOURCE;
  }

  const normalizedSource = String(sourceValue).toLowerCase().trim();

  if (VALID_SOURCES.includes(normalizedSource)) {
    return normalizedSource;
  }
  return DEFAULT_SOURCE;
}

function prepareServiceData(serviceItem, booking, processedPax = []) {
  const now = new Date();
  const expirationDate = new Date(
    Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Descrição dinâmica baseada no tipo
  let description = serviceItem.title || "Descrição não disponível";
  if (serviceItem.room?.category?.value) {
    description = `${serviceItem.room.category.value} com ${serviceItem.room.capacity?.value || "capacidade não informada"}`;
  } else if (serviceItem.title) {
    description = serviceItem.title;
  }

  // Informações do quarto (se aplicável)
  let roomInfo = "";
  if (
    serviceItem.room?.capacity?.code &&
    serviceItem.room?.category?.code &&
    serviceItem.board?.code
  ) {
    roomInfo = `${serviceItem.room.capacity.code} - ${serviceItem.room.category.code} - ${serviceItem.board.code}`;
  }

  // Preparar dados base
  const baseData = {
    Created: now,
    Updated: now,
    Expiration: createSafeDate(serviceItem.expiresAt, expirationDate),
    Confirmation: formatSafeDate(serviceItem.confirmation, now),
    Identifier: serviceItem.identifier || booking.Identifier,
    Status: serviceItem.status || "pending",
    IDMO: booking.IDMO,
    Type: serviceItem.type || SERVICE_TYPES.ROOM,
    XRef: (serviceItem.board?.xref, ""),
    Title: description,
    IDProvider: serviceItem.IDProvider || 0,
    Provider: serviceItem.Provider || "",
    User: booking.User || "",
    IDUser: booking.IDUser || 0,
    Connector: serviceItem.connector?.name || "",
    Booking: serviceItem.connector?.booking || "",
    Source: getValidSource(serviceItem.source),
    CheckIn: formatSafeDate(serviceItem.checkin, now),
    CheckOut: formatSafeDate(serviceItem.checkout, expirationDate),
    People: JSON.stringify({ pax: processedPax }),
    Infant: serviceItem.pax?.infant || 0,
    Child: serviceItem.pax?.child || 0,
    Adult: serviceItem.pax?.adult || DEFAULT_PAX_ADULT,
    Senior: serviceItem.pax?.senior || 0,
    Information: serviceItem.information || "",
    Unit: roomInfo,
    BreakType: serviceItem.break?.type || "",
    BreakPrice: parseNumber(serviceItem.break?.price, 0, true),
    Price: parseNumber(serviceItem.price, 0, true),
    Fee: parseNumber(serviceItem.pricing?.fees?.total, 0, true),
    MarkupInfo: JSON.stringify(serviceItem.pricing?.markup || {}),
    FeeInfo: JSON.stringify(serviceItem.pricing?.fees || {}),
    CommissionInfo: JSON.stringify(serviceItem.pricing?.commission || {}),
    Commission: parseNumber(serviceItem.pricing?.commission?.total, 0, true),
    Discount: parseNumber(serviceItem.discount, 0, true),
    Rebate: parseNumber(serviceItem.rebate, 0, true),
    Cost: parseNumber(serviceItem.price, 0, true),
    Bonification: parseNumber(serviceItem.bonification, 0, true),
    Extra: parseNumber(serviceItem.extra, 0, true),
    Total: parseNumber(
      serviceItem.pricing?.total || serviceItem.price,
      0,
      true,
    ),
    Markup: parseNumber(serviceItem.pricing?.markup?.total, 0, true),
    Currency: serviceItem.currency || "BRL",
    Exchange: JSON.stringify(serviceItem.exchange || {}),
    Options: JSON.stringify(serviceItem.options || []),
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

// Função corrigida para validar dados de transfer com stopovers
function validateTransferServiceData(bookingJsonData, options = {}) {
  // Corrigir a referência para acessar os dados corretamente
  const transferServices = bookingJsonData?.service?.transfer;

  if (!transferServices || !Array.isArray(transferServices)) {
    throw new Error(
      "O campo 'transfer' deve ser um array na estrutura service.transfer",
    );
  }

  transferServices.forEach((transfer, transferIndex) => {
    if (!Array.isArray(transfer.stopover) || transfer.stopover.length === 0) {
      throw new Error(
        `Transfer ${transferIndex + 1}: deve conter ao menos um stopover.`,
      );
    }

    transfer.stopover.forEach((stopover, stopoverIndex) => {
      if (!stopover.origin) {
        throw new Error(
          `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: origem é obrigatória.`,
        );
      }

      if (!stopover.destination) {
        throw new Error(
          `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: destino é obrigatório.`,
        );
      }

      if (!stopover.estimated?.departure || !stopover.estimated?.arrival) {
        throw new Error(
          `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: horários de chegada e partida são obrigatórios.`,
        );
      }

      if (!stopover.perimeter_id) {
        throw new Error(
          `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: perimeter_id é obrigatório.`,
        );
      }
    });
  });

  return { valid: true };
}

export async function buildInsertTransferQuery(transferData) {
  const { query, values } = buildInsertQuery(transferData);
  return { query, values };
}

// Função corrigida para inserir dados de transfer
export async function insertTransferData(
  connection,
  serviceId,
  identifier,
  transferData,
) {
  try {
    // Preparar dados para inserção
    const dataToInsert = {
      ...transferData,
      IDMOS: serviceId, // Garantir que o ID do serviço esteja correto
    };

    const { query, values } = buildInsertTransferQuery(dataToInsert);
    const [result] = await connection.query(query, values);

    if (!result.insertId) {
      return createResponse(
        false,
        {},
        { code: "E136", message: "Erro ao inserir transfer" },
      );
    }

    return createResponse(true, {
      transferId: result.insertId,
      identifier: identifier,
    });
  } catch (error) {
    console.error("Erro ao inserir transfer:", error);
    return createResponse(false, {}, { code: "E137", message: error.message });
  }
}

export async function createServiceFromBooking(
  connection,
  channel,
  serviceType,
  serviceIndex = 0,
  bookingJsonData,
  paxJsonData = null,
  validationOptions = {},
) {
  try {
    // Validar reserva
    const bookingResult = await validateBookingExists(connection, channel);
    if (!bookingResult.success) {
      return bookingResult;
    }

    // Extrair serviço específico da nova estrutura
    const serviceItem = getServiceByTypeAndIndex(
      bookingJsonData,
      serviceType,
      serviceIndex,
    );

    if (!serviceItem) {
      return createResponse(
        false,
        {},
        {
          code: "E128",
          message: `Serviço do tipo '${serviceType}' não encontrado no índice ${serviceIndex}`,
        },
      );
    }

    // Validar dados do serviço
    validateServiceData(serviceItem, validationOptions);

    // Validação específica para transfers com stopovers
    if (serviceType === SERVICE_TYPES.TRANSFER) {
      validateTransferServiceData(bookingJsonData, validationOptions);
    }

    // Processar dados de PAX se disponíveis
    let processedPax = [];
    if (paxJsonData && serviceItem.assigned) {
      processedPax = processPaxData(serviceItem.assigned, paxJsonData);
    }
    // Preparar dados do serviço
    const preparedData = await prepareServiceData(
      serviceItem,
      bookingResult.booking,
      processedPax,
    );

    if (!preparedData) {
      return createResponse(false, {}, { code: "E129" });
    }

    // Inserir serviço principal
    const { query, values } = buildInsertQuery(preparedData);
    const [result] = await connection.query(query, values);

    if (!result.insertId) {
      return createResponse(false, {}, { code: "E127" });
    }

    const serviceId = result.insertId;

    // Se for transfer, processar stopovers
    if (serviceType === SERVICE_TYPES.TRANSFER) {
      const stopoversResult = await insertAllStopovers(
        connection,
        bookingJsonData,
        serviceId,
        preparedData.Identifier,
      );

      if (!stopoversResult.success) {
        return stopoversResult;
      }

      // Recuperar serviço inserido
      const serviceResult = await getInsertedService(connection, serviceId);
      if (!serviceResult.success) {
        return serviceResult;
      }

      return createResponse(true, {
        service: serviceResult.service,
        serviceId: serviceId,
        paxData: processedPax,
        serviceType: serviceType,
        originalIndex: serviceIndex,
        stopovers: stopoversResult,
        message: `Transfer criado com ${stopoversResult.successCount} stopovers inseridos.`,
      });
    }

    // Para outros tipos de serviço, retorno padrão
    const serviceResult = await getInsertedService(connection, serviceId);
    if (!serviceResult.success) {
      return serviceResult;
    }

    return createResponse(true, {
      service: serviceResult.service,
      serviceId: serviceId,
      paxData: processedPax,
      serviceType: serviceType,
      originalIndex: serviceIndex,
      message: messages["S121"],
    });
  } catch (error) {
    console.error("Erro ao criar serviço:", error);
    return createResponse(false, {}, { code: "E122", message: error.message });
  }
}

export async function createAllServicesFromBooking(
  connection,
  channel,
  bookingJsonData,
  paxJsonData = null,
  serviceType,
  serviceIndex = 0,
  validationOptions = {},
) {
  try {
    const results = [];
    const errors = [];

    // Extrair todos os serviços
    const allServices = await extractServicesFromBooking(bookingJsonData);

    if (allServices.length === 0) {
      return createResponse(
        false,
        {},
        {
          code: "E130",
          message: "Nenhum serviço encontrado na reserva",
        },
      );
    }

    // Processar cada serviço
    for (const serviceItem of allServices) {
      try {
        const result = await createServiceFromBooking(
          connection,
          channel,
          serviceItem.serviceGroup,
          serviceItem.originalIndex,
          bookingJsonData,
          paxJsonData,
          validationOptions,
        );

        if (result.success) {
          results.push(result);
        } else {
          errors.push({
            serviceType: serviceItem.serviceGroup,
            index: serviceItem.originalIndex,
            error: result,
          });
        }
      } catch (error) {
        errors.push({
          serviceType: serviceItem.serviceGroup,
          index: serviceItem.originalIndex,
          error: error.message,
        });
      }
    }

    return createResponse(true, {
      createdServices: results,
      errors: errors,
      totalProcessed: allServices.length,
      successCount: results.length,
      serviceType: serviceType,
      originalIndex: serviceIndex,
      errorCount: errors.length,
      code: "S122",
      message: `Processados ${allServices.length} serviços. ${results.length} criados com sucesso, ${errors.length} com erro.`,
    });
  } catch (error) {
    return createResponse(false, {}, { code: "E131", message: error.message });
  }
}

// ============================================================================
// FUNÇÕES ESPECÍFICAS ATUALIZADAS
// ============================================================================

export const createRoomService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.ROOM,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createTransferService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createTransferServiceWithStopovers(
    connection,
    channel,
    SERVICE_TYPES.TRANSFER,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createTicketService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.TICKET,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createRentalService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.RENTAL,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createTourService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.TOUR,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createInsuranceService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.INSURANCE,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createFlightService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.FLIGHT,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createMeetingService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.MEETING,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

export const createNoteService = (
  connection,
  channel,
  bookingJsonData,
  serviceIndex = 0,
  paxJsonData = null,
) => {
  return createServiceFromBooking(
    connection,
    channel,
    SERVICE_TYPES.NOTE,
    serviceIndex,
    bookingJsonData,
    paxJsonData,
  );
};

// ============================================================================
// FUNÇÕES UTILITÁRIAS ADICIONAIS
// ============================================================================

export function listServicesInBooking(bookingJsonData) {
  const allServices = extractServicesFromBooking(bookingJsonData);
  return allServices.map((service) => ({
    type: service.type,
    index: service.originalIndex,
    identifier: service.identifier,
    title: service.title,
  }));
}

export function getServiceCount(bookingJsonData, serviceType = null) {
  if (serviceType) {
    return bookingJsonData?.service?.[serviceType]?.length || 0;
  }

  return extractServicesFromBooking(bookingJsonData).length;
}

export function getServicesFromBooking(bookingJsonData) {
  return extractServicesFromBooking(bookingJsonData);
}
