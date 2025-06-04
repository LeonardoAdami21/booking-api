// Schema de validação para criação de reserva
const reservationSchema = {
  type: "object",
  required: ["business", "reservation"],
  properties: {
    business: { type: "string" },
    reservation: {
      type: "object",
      required: ["type", "language", "currency", "period", "customer"],
      properties: {
        type: { type: "string", enum: ["sale", "quote", "booking"] },
        language: { type: "string", enum: ["pt-br", "en-us", "es"] },
        currency: { type: "string", enum: ["BRL", "USD", "EUR"] },
        information: { type: "string" },
        period: {
          type: "object",
          required: ["start", "end"],
          properties: {
            start: { type: "string" },
            end: { type: "string" },
          },
        },
        channel: {
          type: "object",
          properties: {
            code: { type: "integer" },
            name: { type: "string" },
            description: { type: "string" },
            outsourced: { type: "boolean" },
          },
        },
        company: {
          type: "object",
          properties: {
            reference: { type: "integer" },
            nick: { type: "string" },
            name: { type: "string" },
            document: { type: "string" },
            email: { type: "string", format: "email" },
            website: { type: "string" },
            phone: { type: "string" },
            address: {
              type: "object",
              properties: {
                street: { type: "string" },
                number: { type: "string" },
                district: { type: "string" },
                postal: { type: "string" },
                city: { type: "string" },
                state: { type: "string" },
                country: { type: "string" },
              },
            },
          },
        },
        client: {
          type: "object",
          properties: {
            reference: { type: "integer" },
            name: { type: "string" },
            nick: { type: "string" },
            document: { type: "string" },
            email: { type: "string", format: "email" },
            website: { type: "string" },
            phone: { type: "string" },
            address: {
              type: "object",
              properties: {
                street: { type: "string" },
                number: { type: "string" },
                district: { type: "string" },
                postal: { type: "string" },
                city: { type: "string" },
                state: { type: "string" },
                country: { type: "string" },
                coordinates: {
                  type: "object",
                  properties: {
                    lat: { type: "number" },
                    lng: { type: "number" },
                  },
                },
              },
            },
          },
        },
        customer: {
          type: "object",
          required: ["firstName", "lastName", "email"],
          properties: {
            reference: { type: "integer" },
            firstName: { type: "string", minLength: 2 },
            lastName: { type: "string", minLength: 2 },
            email: { type: "string", format: "email" },
            phone: { type: "string" },
            foreign: { type: "boolean" },
            document: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["CPF", "RG", "PASSPORT", "CNH"],
                },
                number: { type: "string" },
              },
            },
            gender: { type: "string", enum: ["male", "female", "other"] },
            country: { type: "string" },
          },
        },
        agent: {
          type: "object",
          properties: {
            reference: { type: "integer" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", format: "email" },
          },
        },
        pax: {
          type: "object",
          patternProperties: {
            "^PAX[0-9]+$": {
              type: "object",
              properties: {
                main: { type: "boolean" },
                firstName: { type: "string" },
                lastName: { type: "string" },
                phone: { type: "string" },
                email: { type: "string", format: "email" },
                country: { type: "string" },
                document: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    number: { type: "string" },
                  },
                },
                birthdate: { type: "string", format: "date" },
                gender: { type: "string", enum: ["male", "female", "other"] },
                ageGroup: {
                  type: "string",
                  enum: ["adult", "child", "infant"],
                },
              },
            },
          },
        },
      },
    },
  },
};

export default async function reservationRoutes(fastify, options) {
  // POST - Criar nova reserva
  fastify.post(
    "/reservations",
    {
      schema: {
        body: reservationSchema,
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "integer" },
              type: { type: "string" },
              business: { type: "string" },
              hash: { type: "string" },
              version: { type: "integer" },
              reservation: { type: "object" },
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const connection = await fastify.mysql.getConnection();

      try {
        await connection.beginTransaction();

        const { business, reservation } = request.body;

        // Validações de data (mesmo código anterior)
        const startDate = new Date(reservation.period.start);
        const endDate = new Date(reservation.period.end);
        const today = new Date();

        if (startDate < today) {
          return reply.status(400).send({
            id: null,
            type: "reservation",
            business,
            hash: null,
            version: null,
            reservation: null,
            error: "E001",
            message: "Data de início não pode ser no passado",
          });
        }

        // Verificar/inserir customer
        let customerId;
        const [existingCustomer] = await connection.execute(
          "SELECT id FROM customers WHERE email = ?",
          [reservation.customer.email],
        );

        if (existingCustomer.length > 0) {
          customerId = existingCustomer[0].id;
        } else {
          const [customerResult] = await connection.execute(
            `INSERT INTO customers (first_name, last_name, email, phone, \`foreign_customer\`, 
                               document_type, document_number, gender, country)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              reservation.customer.firstName,
              reservation.customer.lastName,
              reservation.customer.email,
              reservation.customer.phone || null,
              reservation.customer.foreign || false,
              reservation.customer.document?.type || null,
              reservation.customer.document?.number || null,
              reservation.customer.gender || null,
              reservation.customer.country || null,
            ],
          );
          customerId = customerResult.insertId;
        }

        // Verificar/inserir agent (se existir)
        let agentId = null;
        if (reservation.agent?.email) {
          const [existingAgent] = await connection.execute(
            "SELECT id FROM agents WHERE email = ?",
            [reservation.agent.email],
          );

          if (existingAgent.length > 0) {
            agentId = existingAgent[0].id;
          } else {
            const [agentResult] = await connection.execute(
              `INSERT INTO agents (reference, first_name, last_name, email, phone)
               VALUES (?, ?, ?, ?, ?)`,
              [
                reservation.agent.reference || null,
                reservation.agent.firstName,
                reservation.agent.lastName,
                reservation.agent.email,
                reservation.agent.phone || null,
              ],
            );
            agentId = agentResult.insertId;
          }
        }

        // Verificar/inserir company (se existir)
        let companyId = null;
        if (reservation.company?.email) {
          const [existingCompany] = await connection.execute(
            "SELECT id FROM companies WHERE email = ?",
            [reservation.company.email],
          );

          if (existingCompany.length > 0) {
            companyId = existingCompany[0].id;
          } else {
            const [companyResult] = await connection.execute(
              `INSERT INTO companies (reference, nick, name, document, email, website, phone, 
                                    street, number, district, postal, city, state, country)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reservation.company.reference || null,
                reservation.company.nick || null,
                reservation.company.name,
                reservation.company.document || null,
                reservation.company.email,
                reservation.company.website || null,
                reservation.company.phone || null,
                reservation.company.address?.street || null,
                reservation.company.address?.number || null,
                reservation.company.address?.district || null,
                reservation.company.address?.postal || null,
                reservation.company.address?.city || null,
                reservation.company.address?.state || null,
                reservation.company.address?.country || null,
              ],
            );
            companyId = companyResult.insertId;
          }
        }

        // Verificar/inserir client (se existir)
        let clientId = null;
        if (reservation.client?.email) {
          const [existingClient] = await connection.execute(
            "SELECT id FROM clients WHERE email = ?",
            [reservation.client.email],
          );

          if (existingClient.length > 0) {
            clientId = existingClient[0].id;
          } else {
            const [clientResult] = await connection.execute(
              `INSERT INTO clients (reference, name, nick, document, email, website, phone,
                                  street, number, district, postal, city, state, country)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reservation.client.reference || null,
                reservation.client.name,
                reservation.client.nick || null,
                reservation.client.document || null,
                reservation.client.email,
                reservation.client.website || null,
                reservation.client.phone || null,
                reservation.client.address?.street || null,
                reservation.client.address?.number || null,
                reservation.client.address?.district || null,
                reservation.client.address?.postal || null,
                reservation.client.address?.city || null,
                reservation.client.address?.state || null,
                reservation.client.address?.country || null,
              ],
            );
            clientId = clientResult.insertId;
          }
        }

        // Gerar dados da reserva
        const identifier = `SALE${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}${String(Date.now()).slice(-8)}`;
        const hash = generateHash();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // ATUALIZAR: Inserir reserva com os IDs relacionados
        const [reservationResult] = await connection.execute(
          `INSERT INTO reservations (business_id, identifier, hash, status, type, language, 
                                   currency, information, period_start, period_end, expires_at, 
                                   customer_id, agent_id, company_id, client_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            business,
            identifier,
            hash,
            "confirmed",
            reservation.type || "sale",
            reservation.language || "pt-br",
            reservation.currency || "BRL",
            reservation.information || "",
            reservation.period.start,
            reservation.period.end,
            expiresAt.toISOString().slice(0, 19).replace("T", " "),
            customerId,
            agentId,
            companyId,
            clientId,
          ],
        );

        const reservationId = reservationResult.insertId;

        // Calcular e inserir totais
        const totals = calculateTotals(reservation);
        await connection.execute(
          `INSERT INTO reservation_totals (reservation_id, service_price, service_commission, 
                                         service_markup, client_total, company_total, grand_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            reservationId,
            totals.service.price,
            totals.service.commission,
            totals.service.markup,
            totals.client.total,
            totals.company.total,
            totals.total,
          ],
        );

        // Inserir PAX se houver
        if (reservation.pax) {
          for (const [paxKey, paxData] of Object.entries(reservation.pax)) {
            await connection.execute(
              `INSERT INTO reservation_pax (reservation_id, pax_key, is_main, first_name, 
                                          last_name, phone, email, country, document_type, 
                                          document_number, birthdate, gender, age_group)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                reservationId,
                paxKey,
                paxData.main || false,
                paxData.firstName || null,
                paxData.lastName || null,
                paxData.phone || null,
                paxData.email || null,
                paxData.country || null,
                paxData.document?.type || null,
                paxData.document?.number || null,
                paxData.birthdate || null,
                paxData.gender || null,
                paxData.ageGroup || null,
              ],
            );
          }
        }

        await connection.commit();

        // NOVA QUERY: Buscar reserva completa com todos os dados relacionados
        const [rows] = await connection.execute(
          `SELECT 
             r.*,
             c.first_name as customer_first_name,
             c.last_name as customer_last_name,
             c.email as customer_email,
             c.phone as customer_phone,
             c.foreign_customer,
             c.document_type as customer_document_type,
             c.document_number as customer_document_number,
             c.gender as customer_gender,
             c.country as customer_country,
             
             a.reference as agent_reference,
             a.first_name as agent_first_name,
             a.last_name as agent_last_name,
             a.email as agent_email,
             a.phone as agent_phone,
             
             comp.reference as company_reference,
             comp.nick as company_nick,
             comp.name as company_name,
             comp.document as company_document,
             comp.email as company_email,
             comp.website as company_website,
             comp.phone as company_phone,
             comp.street as company_street,
             comp.number as company_number,
             comp.district as company_district,
             comp.postal as company_postal,
             comp.city as company_city,
             comp.state as company_state,
             comp.country as company_country,
             
             cl.reference as client_reference,
             cl.name as client_name,
             cl.nick as client_nick,
             cl.document as client_document,
             cl.email as client_email,
             cl.website as client_website,
             cl.phone as client_phone,
             cl.street as client_street,
             cl.number as client_number,
             cl.district as client_district,
             cl.postal as client_postal,
             cl.city as client_city,
             cl.state as client_state,
             cl.country as client_country,
             
             rt.service_price,
             rt.service_commission,
             rt.service_markup,
             rt.client_total,
             rt.company_total,
             rt.grand_total
             
           FROM reservations r
           JOIN customers c ON r.customer_id = c.id
           LEFT JOIN agents a ON r.agent_id = a.id
           LEFT JOIN companies comp ON r.company_id = comp.id
           LEFT JOIN clients cl ON r.client_id = cl.id
           LEFT JOIN reservation_totals rt ON r.id = rt.reservation_id
           WHERE r.id = ?`,
          [reservationId],
        );

        const data = rows[0];

        // Buscar PAX
        const [paxRows] = await connection.execute(
          `SELECT * FROM reservation_pax WHERE reservation_id = ?`,
          [reservationId],
        );

        // Montar objeto PAX
        const paxData = {};
        paxRows.forEach((pax) => {
          paxData[pax.pax_key] = {
            main: pax.is_main,
            firstName: pax.first_name,
            lastName: pax.last_name,
            phone: pax.phone,
            email: pax.email,
            country: pax.country,
            document: pax.document_type
              ? {
                  type: pax.document_type,
                  number: pax.document_number,
                }
              : null,
            birthdate: pax.birthdate,
            gender: pax.gender,
            ageGroup: pax.age_group,
          };
        });

        // Construir response completo
        const response = {
          id: reservationId,
          identifier: data.identifier,
          status: data.status,
          type: data.type,
          language: data.language,
          currency: data.currency,
          information: data.information,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          expiresAt: data.expires_at,
          period: {
            start: data.period_start,
            end: data.period_end,
          },
          customer: {
            id: data.customer_id,
            firstName: data.customer_first_name,
            lastName: data.customer_last_name,
            email: data.customer_email,
            phone: data.customer_phone,
            foreign: data.foreign_customer,
            document: data.customer_document_type
              ? {
                  type: data.customer_document_type,
                  number: data.customer_document_number,
                }
              : null,
            gender: data.customer_gender,
            country: data.customer_country,
          },
          agent: data.agent_id
            ? {
                id: data.agent_id,
                reference: data.agent_reference,
                firstName: data.agent_first_name,
                lastName: data.agent_last_name,
                email: data.agent_email,
                phone: data.agent_phone,
              }
            : null,
          company: data.company_id
            ? {
                id: data.company_id,
                reference: data.company_reference,
                nick: data.company_nick,
                name: data.company_name,
                document: data.company_document,
                email: data.company_email,
                website: data.company_website,
                phone: data.company_phone,
                address: {
                  street: data.company_street,
                  number: data.company_number,
                  district: data.company_district,
                  postal: data.company_postal,
                  city: data.company_city,
                  state: data.company_state,
                  country: data.company_country,
                },
              }
            : null,
          client: data.client_id
            ? {
                id: data.client_id,
                reference: data.client_reference,
                name: data.client_name,
                nick: data.client_nick,
                document: data.client_document,
                email: data.client_email,
                website: data.client_website,
                phone: data.client_phone,
                address: {
                  street: data.client_street,
                  number: data.client_number,
                  district: data.client_district,
                  postal: data.client_postal,
                  city: data.client_city,
                  state: data.client_state,
                  country: data.client_country,
                },
              }
            : null,
          pax: Object.keys(paxData).length > 0 ? paxData : null,
          totals: {
            service: {
              price: data.service_price,
              commission: data.service_commission,
              markup: data.service_markup,
            },
            client: {
              total: data.client_total,
            },
            company: {
              total: data.company_total,
            },
            total: data.grand_total,
          },
        };

        return reply.status(201).send({
          id: reservationId,
          type: "reservation",
          business: business,
          hash: hash,
          version: 1,
          reservation: response,
          error: "E000",
          message: "Reserva criada com sucesso",
        });
      } catch (error) {
        await connection.rollback();
        fastify.log.error(error);
        reply.status(500).send({
          id: null,
          type: "reservation",
          business: request.body?.business || null,
          hash: null,
          version: null,
          reservation: null,
          error: "E999",
          message: "Erro interno do servidor",
        });
      } finally {
        connection.release();
      }
    },
  );
}

function generateHash() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function calculateTotals(reservation) {
  const basePrice = 1000;
  const days = Math.ceil(
    (new Date(reservation.period.end) - new Date(reservation.period.start)) /
      (1000 * 60 * 60 * 24),
  );
  const servicePrice = basePrice * days;
  const commission = servicePrice * 0.15;
  const markup = servicePrice * 0.25;
  const total = servicePrice + commission + markup;

  return {
    service: {
      price: servicePrice,
      commission,
      markup,
      tax: 0,
      discount: 0,
      total,
    },
    client: { total: commission },
    company: { total: markup },
    total,
  };
}
