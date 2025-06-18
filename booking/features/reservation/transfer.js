import { loadErrorMessages } from "../../index.js";
const messages = await loadErrorMessages("pt-BR");

// Função para validar dados de stopover
function validateStopoverData(stopover, transferIndex, stopoverIndex) {
  if (!stopover.perimeter_id) {
    return {
      success: false,
      message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: perímetro de paragem é obrigatório`,
    };
  }

  if (!stopover.origin) {
    return {
      success: false,
      message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: origem é obrigatória`,
    };
  }

  if (!stopover.destination) {
    return {
      success: false,
      message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: destino é obrigatório`,
    };
  }

  if (!stopover.estimated?.departure || !stopover.estimated?.arrival) {
    return {
      success: false,
      message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: horário de partida e chegada é obrigatório`,
    };
  }

  // Validar formato das datas
  if (stopover.estimated?.departure) {
    const departureDate = new Date(stopover.estimated.departure);
    if (isNaN(departureDate.getTime())) {
      return {
        success: false,
        message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: formato de data de partida inválido`,
      };
    }
  }

  if (stopover.estimated?.arrival) {
    const arrivalDate = new Date(stopover.estimated.arrival);
    if (isNaN(arrivalDate.getTime())) {
      return {
        success: false,
        message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: formato de data de chegada inválido`,
      };
    }
  }

  // Validar se chegada é posterior à partida
  if (stopover.estimated?.departure && stopover.estimated?.arrival) {
    const departure = new Date(stopover.estimated.departure);
    const arrival = new Date(stopover.estimated.arrival);

    if (arrival <= departure) {
      return {
        success: false,
        message: `Transfer ${transferIndex + 1}, Stopover ${stopoverIndex + 1}: chegada deve ser posterior à partida`,
      };
    }
  }

  return {
    success: true,
  };
}

// Função para validar estrutura completa de transfer com stopovers
function validateTransferWithStopovers(transferData) {
  if (
    !transferData?.service?.transfer ||
    !Array.isArray(transferData.service.transfer)
  ) {
    return {
      success: false,
      message: "Transfer deve conter um array de stopovers",
    };
  }

  transferData.service.transfer.forEach((transfer, transferIndex) => {
    if (!transfer.stopover || !Array.isArray(transfer.stopover)) {
      return {
        success: false,
        message: `Transfer ${transferIndex + 1}: stopovers deve ser um array`,
      };
    }

    if (transfer.stopover.length === 0) {
      return {
        success: false,
        message: `Transfer ${transferIndex + 1}: stopovers deve conter ao menos um stopover`,
      };
    }

    transfer.stopover.forEach((stopover, stopoverIndex) => {
      const stopoverErrors = validateStopoverData(
        stopover,
        transferIndex,
        stopoverIndex,
      );

      if (!stopoverErrors.success) {
        return {
          success: false,
          message: stopoverErrors.message,
        };
      }
    });
  });

  return {
    success: true,
  };
}

// Função para preparar dados de um stopover para inserção na tabela TRANSFER
function prepareStopoverForTransfer(stopover, serviceId, identifier) {
  return {
    IDMO: serviceId, // Será definido pela aplicação
    IDPerimeter: parseInt(stopover.perimeter_id) || 0,
    Identifier: identifier,
    Estimed: JSON.stringify({
      departure: stopover.estimated?.departure || null,
      arrival: stopover.estimated?.arrival || null,
    }),
    Driver: JSON.stringify({
      name: stopover.driver?.name || "",
      phone: stopover.driver?.phone || "",
    }),
    Number: stopover.number || "",
    Origin: JSON.stringify({
      name: stopover.origin?.name || "",
      city: stopover.origin?.city || "",
      state: stopover.origin?.state || "",
      type: stopover.origin?.type || "",
      country: stopover.origin?.country || "",
      iata: stopover.origin?.iata || "",
      coordinates: {
        lat: stopover.origin?.coordinates?.lat || null,
        lng: stopover.origin?.coordinates?.lng || null,
      },
    }),
    Destination: JSON.stringify({
      name: stopover.destination?.name || "",
      city: stopover.destination?.city || "",
      state: stopover.destination?.state || "",
      type: stopover.destination?.type || "",
      country: stopover.destination?.country || "",
      coordinates: {
        lat: stopover.destination?.coordinates?.lat || null,
        lng: stopover.destination?.coordinates?.lng || null,
      },
    }),
    Vehicle: JSON.stringify({
      name: stopover.vehicle?.name || "",
      classification: stopover.vehicle?.classification || "",
      capacity: stopover.vehicle?.capacity || 0,
      plate: stopover.vehicle?.plate || "",
    }),
  };
}

// Função para construir query de inserção para TRANSFER
function buildTransferInsertQuery(transferData) {
  const fields = [];
  const values = [];
  const placeholders = [];

  for (const [key, value] of Object.entries(transferData)) {
    if (value !== null && value !== undefined) {
      fields.push(key);
      values.push(value);
      placeholders.push("?");
    }
  }

  return {
    query: `INSERT INTO TRANSFER (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values,
  };
}

// Função para inserir um único stopover na tabela TRANSFER
export async function insertStopoverTransfer(
  connection,
  stopover,
  serviceId,
  identifier,
) {
  try {
    const transferData = prepareStopoverForTransfer(
      stopover,
      serviceId,
      identifier,
    );
    const { query, values } = buildTransferInsertQuery(transferData);

    const [result] = await connection.query(query, values);

    if (!result.insertId) {
      throw new Error("Erro ao inserir stopover na tabela TRANSFER");
    }

    return {
      success: true,
      transferId: result.insertId,
      data: transferData,
    };
  } catch (error) {
    console.error("Erro ao inserir stopover:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Função para inserir todos os stopovers de um transfer
export async function insertAllStopovers(
  connection,
  transferData,
  serviceId,
  identifier,
) {
  const results = [];
  const errors = [];

  // Validar estrutura primeiro
  const validationErrors = validateTransferWithStopovers(transferData);
  if (validationErrors.length > 0) {
    return {
      success: false,
      errors: validationErrors,
    };
  }

  // Processar cada transfer e seus stopovers
  for (
    let transferIndex = 0;
    transferIndex < transferData.service.transfer.length;
    transferIndex++
  ) {
    const transfer = transferData.service.transfer[transferIndex];

    for (
      let stopoverIndex = 0;
      stopoverIndex < transfer.stopover.length;
      stopoverIndex++
    ) {
      const stopover = transfer.stopover[stopoverIndex];

      try {
        // Criar identificador único para cada stopover
        const stopoverIdentifier = `${identifier}-T${transferIndex + 1}-S${stopoverIndex + 1}`;

        const result = await insertStopoverTransfer(
          connection,
          stopover,
          serviceId,
          stopoverIdentifier,
        );

        if (result.success) {
          results.push({
            transferIndex,
            stopoverIndex,
            transferId: result.transferId,
            identifier: stopoverIdentifier,
          });
        } else {
          errors.push({
            transferIndex,
            stopoverIndex,
            error: result.error,
          });
        }
      } catch (error) {
        errors.push({
          transferIndex,
          stopoverIndex,
          error: error.message,
        });
      }
    }
  }

  return {
    success: errors.length === 0,
    results,
    errors,
    totalProcessed: results.length + errors.length,
    successCount: results.length,
    errorCount: errors.length,
  };
}

// Função principal para criar serviço de transfer com stopovers
export async function createTransferServiceWithStopovers(
  connection,
  channel,
  serviceType,
  serviceIndex,
  bookingJsonData,
  paxJsonData = null,
) {
  try {
    // Primeiro, criar o serviço principal usando a função existente
    const serviceResult = await createServiceFromBooking(
      connection,
      channel,
      serviceType,
      serviceIndex,
      bookingJsonData,
      paxJsonData,
    );

    if (!serviceResult.success) {
      return serviceResult;
    }

    // Extrair dados do transfer da estrutura de dados
    const transferService = bookingJsonData?.service?.transfer?.[serviceIndex];

    if (!transferService) {
      return {
        success: false,
        error: "E140",
        message: "Dados de transfer não encontrados no índice especificado",
      };
    }

    // Inserir todos os stopovers
    const stopoversResult = await insertAllStopovers(
      connection,
      { service: { transfer: [transferService] } },
      serviceResult.serviceId,
      serviceResult.service.Identifier,
    );

    return {
      success: true,
      service: serviceResult.service,
      serviceId: serviceResult.serviceId,
      paxData: serviceResult.paxData,
      stopovers: stopoversResult,
      code: "S130",
      message: `Transfer criado com sucesso. ${stopoversResult.successCount} stopovers inseridos, ${stopoversResult.errorCount} com erro.`,
    };
  } catch (error) {
    console.error("Erro ao criar transfer com stopovers:", error);
    return {
      success: false,
      error: "E141",
      message: error.message,
    };
  }
}

// Função para buscar transfers inseridos
export async function getTransfersByService(connection, serviceId) {
  try {
    const [result] = await connection.query(
      `SELECT IDMOS, IDMO, IDPerimeter, Identifier, Estimed, Driver, Number,
              Origin, Destination, Vehicle
       FROM TRANSFER 
       WHERE IDMOS = ?
       ORDER BY IDMOS`,
      [serviceId],
    );

    return {
      success: true,
      transfers: result.map((transfer) => ({
        ...transfer,
        Estimed: transfer.Estimed ? JSON.parse(transfer.Estimed) : null,
        Driver: transfer.Driver ? JSON.parse(transfer.Driver) : null,
        Origin: transfer.Origin ? JSON.parse(transfer.Origin) : null,
        Destination: transfer.Destination
          ? JSON.parse(transfer.Destination)
          : null,
        Vehicle: transfer.Vehicle ? JSON.parse(transfer.Vehicle) : null,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Função utilitária para contar stopovers em um transfer
export function countStopovers(transferData) {
  if (!transferData?.service?.transfer) return 0;

  return transferData.service.transfer.reduce((total, transfer) => {
    return total + (transfer.stopover?.length || 0);
  }, 0);
}

// Função para extrair informações resumidas dos stopovers
export function getStopoversSummary(transferData) {
  const summary = [];

  if (!transferData?.service?.transfer) return summary;

  transferData.service.transfer.forEach((transfer, transferIndex) => {
    if (transfer.stopover) {
      transfer.stopover.forEach((stopover, stopoverIndex) => {
        summary.push({
          transferIndex,
          stopoverIndex,
          origin: stopover.origin?.name || "Origem não informada",
          destination: stopover.destination?.name || "Destino não informado",
          departure: stopover.estimated?.departure,
          arrival: stopover.estimated?.arrival,
          vehicle: stopover.vehicle?.name || "Veículo não informado",
        });
      });
    }
  });

  return summary;
}
