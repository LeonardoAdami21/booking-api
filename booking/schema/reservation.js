// Schema de validação para criação de reserva
export const reservationSchema = {
  type: "object",
  required: ["business", "reservation"],
  properties: {
    business: { type: "string", maxLength: 255 },
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
                gender: { type: "string", enum: ["male", "female"] },
                ageGroup: {
                  type: "string",
                  enum: ["adult", "child", "infant", "senior"],
                },
              },
            },
          },
        },
      },
    },
    room: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id", //IDMO
          "status",
          "identifier", // VEM JA NO JSON
          "createdAt",
          "updatedAt",
          "expiresAt",
          "confirmation",
          "title",

          "supplier",
          "connector", // [{"type":"connector","locador":"123912919","name":"hotelbeds"},{"type":"connector","locador":"123912919","name":"hotelbeds"}]
          "distributor", // inserir estes dois no Locators
          "period",
          "cancellation",
          "currency",
          "price",
          "total",
          "destination",
          "pax",
        ],
        properties: {
          id: { type: "integer" },
          status: { type: "string" },
          identifier: { type: "string" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
          expiresAt: { type: "string" },
          confirmation: { type: "string" },
          image: {
            type: "array",
            items: { type: "string", format: "uri" },
          },
          type: { type: "string" }, // category
          title: { type: "string" },
          description: { type: "string" },
          chain: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
            },
          },
          room: {
            type: "object",
            properties: {
              category: {
                type: "object",
                properties: {
                  value: { type: "string" },
                  code: { type: "string" },
                },
              },
              capacity: {
                type: "object",
                properties: {
                  value: { type: "string" },
                  code: { type: "string" },
                },
              },
            },
          },
          board: {
            type: "object",
            properties: {
              code: { type: "string" },
              value: { type: "string" },
              description: { type: "string" },
            },
          },
          star: { type: "integer" },
          amenities: {
            type: "array",
            items: { type: "string" },
          },
          supplier: {
            type: "object",
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
              email: { type: "string", format: "email" },
              website: { type: "string", format: "uri" },
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
          connector: {
            type: "object",
            properties: {
              description: { type: "string" },
              name: { type: "string" },
              code: { type: "string" },
            },
          },
          distributor: {
            type: "object",
            properties: {
              description: { type: "string" },
              name: { type: "string" },
              code: { type: "string" },
            },
          },
          period: {
            type: "object",
            required: ["start", "end"],
            properties: {
              start: { type: "string", format: "date-time" },
              end: { type: "string", format: "date-time" },
            },
          },
          cancellation: {
            type: "object",
            properties: {
              deadline: { type: "integer" },
              amount: { type: "number" },
              percent: { type: "number" },
              currency: { type: "string" },
              from: { type: "string", format: "date-time" },
              name: { type: "string" },
              description: { type: "string" },
            },
          },
          policies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          currency: { type: "string" },
          break: {
            type: "object",
            properties: {
              type: { type: "string" },
              price: { type: "number" },
            },
          },
          price: { type: "number" },
          total: { type: "number" },
          package: {
            type: "object",
            properties: {
              included: { type: "boolean" },
              description: { type: "string" },
            },
          },
          pricing: {
            type: "object",
            properties: {
              taxes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    price: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        before: { type: "number" },
                        after: { type: "number" },
                        total: { type: "number" },
                        currency: { type: "string" },
                      },
                    },
                    commission: {
                      type: "object",
                      properties: {
                        percent: { type: "number" },
                        value: { type: "number" },
                      },
                    },
                    markup: {
                      type: "object",
                      properties: {
                        percent: { type: "number" },
                        value: { type: "number" },
                      },
                    },
                  },
                },
              },
              markup: {
                type: "object",
                properties: {
                  included: { type: "boolean" },
                  current: { type: "number" },
                  applied: { type: "number" },
                  total: { type: "number" },
                  currency: { type: "string" },
                },
              },
              commission: {
                type: "object",
                properties: {
                  included: { type: "boolean" },
                  current: { type: "number" },
                  applied: { type: "number" },
                  total: { type: "number" },
                  currency: { type: "string" },
                },
              },
            },
          },
          exchange: {
            type: "object",
            properties: {
              buy: { type: "number" },
              operation: { type: "number" },
              from: { type: "string" },
              to: { type: "string" },
            },
          },
          assigned: {
            type: "array",
            items: { type: "string" },
          },
          information: { type: "string" },
          destination: {
            type: "object",
            properties: {
              type: { type: "string" },
              name: { type: "string" },
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
          pax: {
            type: "object",
            properties: {
              infant: { type: "integer" },
              child: { type: "integer" },
              adult: { type: "integer" },
              senior: { type: "integer" },
              child_ages: {
                type: "array",
                items: { type: "integer" },
              },
            },
          },
          repository: { type: "object" },
        },
      },
    },
  },
};
