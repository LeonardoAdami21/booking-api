import { loadErrorMessages } from "../../index.js";

const messages = await loadErrorMessages("pt-BR");

// Função para validar se a reserva existe
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
      return {
        valid: false,
        error: "E116",
        message: messages["E116"],
      };
    }

    const reservation = result[0];

    // Verificar se a reserva está em status válido para adicionar serviços
    if (reservation.Status === "cancelled") {
      return {
        valid: false,
        error: "E126",
        message: messages["E126"],
      };
    }

    return {
      valid: true,
      reservation: reservation,
    };
  } catch (error) {
    // ❌ ERRO CORRIGIDO: throw new Error() não aceita objeto
    throw new Error(messages["E114"] || "Erro na validação da reserva");
  }
}

// Função para obter o serviço inserido
export async function getInsertedService(connection, serviceId) {
  try {
    if (!connection || !serviceId) {
      return {
        error: "E130",
        message:
          messages["E130"] || "Parâmetros inválidos para busca do serviço.",
      };
    }

    const [result] = await connection.query(
      `SELECT IDMOS, IDMO, Identifier, Status, Description, Price, Total, 
              Currency, StartDate, EndDate, Information 
       FROM SERVICE 
       WHERE IDMOS = ? LIMIT 1`,
      [serviceId],
    );

    if (!Array.isArray(result) || result.length === 0) {
      return {
        error: "E131",
        message: messages["E131"] || "Serviço não encontrado após inserção.",
      };
    }

    return result[0];
  } catch (error) {
    return {
      error: "E127",
      message: messages["E127"] || "Erro ao buscar serviço inserido.",
    };
  }
}

// Função para validar reserva
export function validateRoomService(room) {
  // Validações básicas obrigatórias
  if (!room.identifier) {
    // ❌ ERRO CORRIGIDO: throw new Error() não aceita objeto
    throw new Error(
      messages["E115"] || "Identificador do quarto é obrigatório",
    );
  }

  if (!room.period || !room.period.start || !room.period.end) {
    throw new Error(messages["E123"] || "Período é obrigatório");
  }

  if (!room.supplier || !room.supplier.id) {
    throw new Error(messages["E124"] || "Fornecedor é obrigatório");
  }

  if (!room.pax || (!room.pax.adult && !room.pax.child)) {
    throw new Error(
      messages["E125"] || "Informações de ocupação são obrigatórias",
    );
  }

  // Validar datas
  const startDate = new Date(room.period.start);
  const endDate = new Date(room.period.end);

  if (endDate <= startDate) {
    throw new Error(
      messages["E110"] || "Data de fim deve ser posterior à data de início",
    );
  }

  return {
    valid: true,
  };
}

// Função para preparar os dados simples do serviço
export async function prepareSimpleServiceData(idmo, room, reservation) {
  const serviceData = {
    Created: new Date(),
    Updated: new Date(),
    Expiration: new Date(room.expiresAt),
    Confirmation: new Date(room.confirmation).toISOString().split("T")[0],
    Code: parseIntegerField(room.board.code) || 0,
    IdMO: idmo,
    IDOrder: reservation.Identifier,
    Identifier: room.identifier || "",
    Type: room.type || "room",
    Status: parseIntegerField(room.status),
    Description: JSON.stringify(
      room?.room?.category?.value + " com " + room?.room?.capacity.value || {},
    ),
    IDAttendant: reservation.IDAttendant || 0,
    Attendant: reservation.Attendant || "",
    Supplier: JSON.stringify(room.supplier.name || {}),
    IDSupplier: room.supplier.id || 0,
    User: JSON.stringify(reservation.User || {}),
    IDUser: reservation.IDUser || 0,
    Locator: JSON.stringify(room.connector.code || {}),
    StartLocation: JSON.stringify(room.destination.name || {}),
    EndLocation: JSON.stringify(room.destination.name || {}),
    StartDate: new Date(room.period.start).toISOString().split("T")[0],
    EndDate: new Date(room.period.end).toISOString().split("T")[0],
    People: JSON.stringify(room.pax || {}),
    Infant: room.pax?.infant || 0,
    Child: room.pax?.child || 0,
    Adult: room.pax?.adult || 2,
    Senior: room.pax?.senior || 0,
    Information: room.information || "",
    Room: JSON.stringify(
      room.room.capacity.code +
        " - " +
        room.room.category.code +
        "- " +
        room.board.code || {},
    ).split(" "),
    BreakType: JSON.stringify(room.break?.type || {}),
    BreakPrice: JSON.stringify(room.break?.price || 0),
    Price: parseFloat(room.price || 0),
    Taxes: JSON.stringify(room?.pricing.taxes.total || 0),
    MarkupInfo: JSON.stringify(room.pricing?.markup?.total || 0),
    CommissionInfo: parseFloat(room?.pricing?.commission?.total || 0),
    Discount: parseFloat(0),
    Rebate: parseFloat(0),
    Cost: JSON.stringify(room.price || 0),
    Bonification: JSON.stringify(room.bonification || 0),
    Extra: JSON.stringify(room.extra || 0),
    Total: parseFloat(room.total || room.price || 0),
    PriceSource: JSON.stringify(room.price_source || 0),
    Currency: room.currency || "BRL",
    Exchange: JSON.stringify(
      room.exchange.from + " - " + room.exchange.to || 0,
    ),
  };

  return serviceData;
}

// Função para verificar duplicata de serviço
export async function checkDuplicateService(connection, identifier, idmo) {
  try {
    const [existing] = await connection.query(
      "SELECT IDMOS, Identifier, Status FROM `SERVICE` WHERE Identifier = ? AND IDMO = ? LIMIT 1",
      [identifier, idmo],
    );
    return existing.length > 0 ? existing[0] : null;
  } catch (error) {
    return {
      error: "E127",
      message: messages["E127"],
    };
  }
}

// Função para criar query de inserção de serviço
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

// Função principal para criar serviço de quarto
export async function createRoomService(connection, business, idmo, room) {
  try {
    if (idmo == null) {
      return {
        success: false,
        error: "E116",
        message: messages["E116"],
      };
    }

    // 1. Validar se a reserva existe
    const reservationValidation = await validateReservationExists(
      connection,
      idmo,
      business,
    );
    if (!reservationValidation.valid) {
      return {
        success: false,
        error: reservationValidation.error,
        message: reservationValidation.message,
      };
    }

    // 2. Validar dados do serviço
    try {
      const serviceValidation = validateRoomService(room);
      if (!serviceValidation.valid) {
        return {
          success: false,
          error: "E117",
          message: messages["E117"],
        };
      }
    } catch (validationError) {
      return {
        success: false,
        error: "E117",
        message: validationError.message,
      };
    }

    // 3. Verificar duplicata
    const duplicate = await checkDuplicateService(
      connection,
      room.identifier,
      idmo,
    );
    if (duplicate && !duplicate.error) {
      return {
        success: false,
        error: "E128",
        message: messages["E128"],
      };
    }

    // 4. Preparar dados para inserção
    const serviceData = await prepareSimpleServiceData(
      idmo,
      room,
      reservationValidation.reservation,
    );

    // 🚨 VALIDAÇÃO CRÍTICA: Verificar IDMO na posição correta (índice 5)
    if (!serviceData.IdMO) {
      return {
        success: false,
        error: "E132",
        message: "IDMO é obrigatório e não pode ser null ou zero",
      };
    }

    const { query: insertQuery, values } = getServiceInsertQuery(serviceData);
    const [result] = await connection.query(insertQuery, values);

    if (!result.insertId) {
      return {
        success: false,
        error: "E127",
        message: messages["E127"],
      };
    }

    // 6. Recuperar serviço inserido
    const insertedService = await getInsertedService(
      connection,
      result.insertId,
    );

    // ✅ CORRIGIDO: Verificar se houve erro na busca
    if (insertedService.error) {
      return {
        success: false,
        error: insertedService.error,
        message: insertedService.message,
      };
    }

    return {
      success: true,
      service: insertedService,
      serviceId: result.insertId,
      code: "S121", // ✅ CORRIGIDO: era "error", deveria ser "code" para sucesso
      message: messages["S121"],
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      error: "E122",
      service: null, // ✅ CORRIGIDO: era array vazio, melhor null
      message: messages["E122"],
    };
  }
}

// Função para validar dados do serviço de quarto
function parseIntegerField(value, defaultValue = 0) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10); // ✅ CORRIGIDO: adicionar radix
  return isNaN(parsed) ? defaultValue : parsed;
}
