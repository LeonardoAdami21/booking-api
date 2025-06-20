import { loadErrorMessages } from "../../index.js";
import { createServiceFromBooking } from "./services.js";
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
    !Array.isArray(transferData?.service?.transfer)
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

export async function searchPaxInOrder(connection, idmo) {
  const [result] = await connection.query(
    `SELECT IDMO FROM \`ORDER\` WHERE IDMO = ? LIMIT 1`,
    [idmo],
  );
  if (result.length > 0) {
    return result;
  } else {
    return [];
  }
}

// Função melhorada para processar dados de PAX com debug detalhado
function processPaxData(assignedPaxIds, paxJsonData) {
  // Validação inicial
  if (!paxJsonData) {
    return {
      success: false,
      message: "Nenhum dado de PAX fornecido",
    };
  }

  if (!assignedPaxIds || assignedPaxIds.length === 0) {
    return {
      success: false,
      message: "Nenhum ID de PAX atribuído",
    };
  }

  // CORREÇÃO: Achatar array aninhado se necessário
  let assignedIds = assignedPaxIds;

  // Se o primeiro elemento é um array, achatar
  if (Array.isArray(assignedIds[0])) {
    assignedIds = assignedIds.flat();
  }

  // Converter para array se for string
  if (!Array.isArray(assignedIds)) {
    assignedIds = [assignedIds];
  }

  // Processar cada PAX
  const processedPax = assignedIds
    .map((paxId, index) => {
      console.log(
        `🔄 [DEBUG] Processando PAX ${index + 1}/${assignedIds.length}: ${paxId}`,
      );

      // CORREÇÃO: Buscar no campo 'pax' do paxJsonData
      const paxDetails = paxJsonData[paxId];

      if (!paxDetails) {
        return {
          success: false,
          message: `PAX ${paxId} não encontrado no JSON de PAX`,
        };
      }
      // Verificar campos obrigatórios
      const hasFirstName = !!(
        paxDetails.firstName && paxDetails.firstName.trim()
      );
      const hasLastName = !!(paxDetails.lastName && paxDetails.lastName.trim());

      // Aceita PAX com pelo menos nome OU sobrenome
      if (!hasFirstName && !hasLastName) {
        return null;
      }

      // Formatar dados do PAX
      const processedPaxData = {
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
      };
      return processedPaxData;
    })
    .filter((pax) => pax !== null);
  return processedPax;
}

// Função para buscar assigned em múltiplos locais possíveis
function getAssignedPaxIds(bookingJsonData, transferIndex = 0) {
  let assignedIds = [];

  // 1. Primeiro: verificar se há assigned no nível raiz do booking
  if (bookingJsonData?.assigned && Array.isArray(bookingJsonData.assigned)) {
    assignedIds = bookingJsonData.assigned;
    return assignedIds;
  }

  // 2. Segundo: verificar no nível do service
  if (
    bookingJsonData?.service?.assigned &&
    Array.isArray(bookingJsonData.service.assigned)
  ) {
    assignedIds = bookingJsonData.service.assigned;
    return assignedIds;
  }

  // 3. CORREÇÃO PRINCIPAL: verificar no transfer específico
  if (
    bookingJsonData?.service?.transfer &&
    Array.isArray(bookingJsonData.service.transfer)
  ) {
    const transfers = bookingJsonData.service.transfer;

    if (
      transfers[transferIndex] &&
      transfers[transferIndex].assigned &&
      Array.isArray(transfers[transferIndex].assigned)
    ) {
      assignedIds = transfers[transferIndex].assigned;
      return assignedIds;
    }
  }

  // 4. Buscar em qualquer transfer disponível se não encontrou no específico
  if (
    bookingJsonData?.service?.transfer &&
    Array.isArray(bookingJsonData.service.transfer)
  ) {
    for (let i = 0; i < bookingJsonData.service.transfer.length; i++) {
      const transfer = bookingJsonData.service.transfer[i];
      if (transfer.assigned && Array.isArray(transfer.assigned)) {
        assignedIds = transfer.assigned;
        return assignedIds;
      }
    }
  }
  return [];
}

function getIncludedCodes(serviceItem) {
  if (!serviceItem?.included || !Array.isArray(serviceItem.included)) {
    return [];
  }

  return serviceItem.included.map((item) => item.code);
}

// FUNÇÃO CORRIGIDA - prepareStopoverForTransfer agora usa corretamente os dados de PAX
function prepareStopoverForTransfer(
  stopover,
  transfer, // Agora recebe o transfer
  serviceId,
  identifier,
  paxJsonData = {}, // Renomeado para ser mais claro
) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const assignedPaxIds = transfer.assigned || [];

  // Processar PAX usando os IDs do assigned
  let paxList = [];
  if (assignedPaxIds.length > 0 && paxJsonData) {
    paxList = processPaxData(assignedPaxIds, paxJsonData);
  }
  return {
    IDMO: serviceId,
    Created: now,
    IDPerimeter: parseInt(stopover.perimeter_id) || 0,
    Identifier: identifier,
    Driver: stopover.driver?.name || "",
    IDDriver: parseInt(JSON.stringify(stopover.driver?.id) || null),
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
    Arrival: stopover.estimated?.arrival,
    Departure: stopover.estimated?.departure,
    People: JSON.stringify({
      pax: paxList,
    }),
    Mode: stopover.mode || "private",
    Included: JSON.stringify(getIncludedCodes(stopover.included) || []),
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
    Vehicle: stopover.vehicle?.name || "",
    Plate: JSON.stringify(stopover.vehicle?.plate || ""),
    Options: stopover.options || "",
  };
}

// Função para construir query de inserção para TRANSFER
export async function buildTransferInsertQuery(transferData) {
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

  if (fields.length === 0) {
    return {
      message: "Nenhum dado para inserir na tabela TRANSFER",
      values: [],
    };
  }

  return {
    query: `INSERT INTO TRANSFER (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values,
  };
}

// FUNÇÃO CORRIGIDA - insertStopoverTransfer agora passa os dados corretos
export async function insertStopoverTransfer(
  connection,
  stopover,
  transfer,
  serviceId,
  identifier,
  paxJsonData = null, // Renomeado para clareza
) {
  try {
    const transferData = prepareStopoverForTransfer(
      stopover,
      transfer,
      serviceId,
      identifier,
      paxJsonData,
    );
    const { query, values } = await buildTransferInsertQuery(transferData);

    const [result] = await connection.query(query, values);

    if (!result) {
      return {
        success: false,
        error: "Erro ao inserir stopover",
      };
    }

    return {
      success: true,
      transferId: result,
      data: transferData,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// FUNÇÃO CORRIGIDA - insertAllStopovers agora processa PAX corretamente
export async function insertAllStopovers(
  connection,
  transferData,
  serviceId,
  identifier,
  paxJsonData = null, // Agora recebe o paxJsonData completo
) {
  let results = [];
  let successCount = 0;
  let errorCount = 0;

  // Validar estrutura primeiro
  const validationErrors = validateTransferWithStopovers(transferData);
  if (!validationErrors.success) {
    return {
      success: false,
      error: "E129",
      message: "Estrutura de transfer inválida",
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
          transfer, // Passa o transfer completo
          serviceId,
          stopoverIdentifier,
          paxJsonData, // Passa o paxJsonData
        );

        if (result.success) {
          results.push(result);
          successCount++;
        } else {
          return {
            success: false,
            error: "E130",
            message: "Erro ao inserir stopover",
          };
        }
      } catch (error) {
        return {
          success: false,
          error: "E130",
          message: "Erro interno no servidor",
        };
      }
    }
  }

  return {
    success: successCount > 0,
    message: `${successCount} stopovers inseridos com sucesso, ${errorCount} com erro`,
    results,
    successCount,
    errorCount,
  };
}

// FUNÇÃO PRINCIPAL CORRIGIDA - createTransferServiceWithStopovers
export async function createTransferServiceWithStopovers(
  connection,
  channel,
  serviceType,
  serviceIndex = 0,
  bookingJsonData,
  paxJsonData = {},
) {
  try {
    const assignedPaxIds = getAssignedPaxIds(bookingJsonData, serviceIndex);
    let finalPaxIds = assignedPaxIds;
    if (!assignedPaxIds || assignedPaxIds.length === 0) {
      finalPaxIds = bookingJsonData.assigned || [];
    }

    // Processar PAX se houver dados
    let processedPaxData = [];
    if (paxJsonData && finalPaxIds.length > 0) {
      processedPaxData = processPaxData(finalPaxIds, paxJsonData);
    }

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

    // Inserir todos os stopovers com os dados de PAX processados
    const stopoversResult = await insertAllStopovers(
      connection,
      { service: { transfer: [transferService] } },
      serviceResult.serviceId,
      serviceResult.service.Identifier,
      processedPaxData, // Passar os dados processados de PAX
    );

    return {
      success: true,
      service: serviceResult.service,
      serviceId: serviceResult.serviceId,
      paxData: processedPaxData, // Retornar os dados processados
      stopovers: stopoversResult,
      code: "S130",
      message: `Transfer criado com sucesso. ${stopoversResult.successCount} stopovers inseridos, ${stopoversResult.errorCount} com erro.`,
    };
  } catch (error) {
    return {
      success: false,
      error: "E141",
      message: messages["E141"],
    };
  }
}

// Função para buscar transfers inseridos
export async function getTransfersByService(connection, serviceId) {
  try {
    const [result] = await connection.query(
      `SELECT Identifier IDMO, Created, Mode, IDPerimeter, 
        Vehicle, Origin, Destination, Arrival, Departure, People
       FROM TRANSFER 
       WHERE IDMO = ? 
       LIMIT 1`,
      [serviceId],
    );

    if (result.length === 0) {
      return {
        success: false,
        error: "E141",
        message: messages["E141"],
      };
    }

    return {
      success: true,
      transfers: result[0],
    };
  } catch (error) {
    console.error("Erro ao buscar transfers:", error);
    return {
      success: false,
      error: "E142",
      message: messages["E142"],
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
