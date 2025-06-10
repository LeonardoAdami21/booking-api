// // Schema de validação para criação de reserva
 export const reservationSchema = {
//   type: "object",
//   required: ["business", "reservation"],
//   properties: {
//     business: { type: "string"},
//     reservation: {
//       type: "object",
//       required: ["type", "language", "currency", "period", "customer"],
//       properties: {
//         type: { type: "string", enum: ["sale", "quote", "booking"] },
//         language: { type: "string", enum: ["pt-br", "en-us", "es"] },
//         currency: { type: "string", enum: ["BRL", "USD", "EUR"] },
//         information: { type: "string" },
//         period: {
//           type: "object",
//           required: ["start", "end"],
//           properties: {
//             start: { type: "string" },
//             end: { type: "string" },
//           },
//         },
//         channel: {
//           type: "object",
//           properties: {
//             code: { type: "integer" },
//             name: { type: "string" },
//             description: { type: "string" },
//             outsourced: { type: "boolean" },
//           },
//         },
//         company: {
//           type: "object",
//           properties: {
//             reference: { type: "integer" },
//             nick: { type: "string" },
//             name: { type: "string" },
//             document: { type: "string" },
//             email: { type: "string", format: "email" },
//             website: { type: "string" },
//             phone: { type: "string" },
//             address: {
//               type: "object",
//               properties: {
//                 street: { type: "string" },
//                 number: { type: "string" },
//                 district: { type: "string" },
//                 postal: { type: "string" },
//                 city: { type: "string" },
//                 state: { type: "string" },
//                 country: { type: "string" },
//               },
//             },
//           },
//         },
//         client: {
//           type: "object",
//           properties: {
//             reference: { type: "integer" },
//             name: { type: "string" },
//             nick: { type: "string" },
//             document: { type: "string" },
//             email: { type: "string", format: "email" },
//             website: { type: "string" },
//             phone: { type: "string" },
//             address: {
//               type: "object",
//               properties: {
//                 street: { type: "string" },
//                 number: { type: "string" },
//                 district: { type: "string" },
//                 postal: { type: "string" },
//                 city: { type: "string" },
//                 state: { type: "string" },
//                 country: { type: "string" },
//                 coordinates: {
//                   type: "object",
//                   properties: {
//                     lat: { type: "number" },
//                     lng: { type: "number" },
//                   },
//                 },
//               },
//             },
//           },
//         },
//         customer: {
//           type: "object",
//           required: ["firstName", "lastName", "email"],
//           properties: {
//             reference: { type: "integer" },
//             firstName: { type: "string", minLength: 2 },
//             lastName: { type: "string", minLength: 2 },
//             email: { type: "string", format: "email" },
//             phone: { type: "string" },
//             foreign: { type: "boolean" },
//             document: {
//               type: "object",
//               properties: {
//                 type: {
//                   type: "string",
//                   enum: ["CPF", "RG", "PASSPORT", "CNH"],
//                 },
//                 number: { type: "string" },
//               },
//             },
//             gender: { type: "string", enum: ["male", "female", "other"] },
//             country: { type: "string" },
//           },
//         },
//         agent: {
//           type: "object",
//           properties: {
//             reference: { type: "integer" },
//             firstName: { type: "string" },
//             lastName: { type: "string" },
//             phone: { type: "string" },
//             email: { type: "string", format: "email" },
//           },
//         },
//         pax: {
//           type: "object",
//           patternProperties: {
//             "^PAX[0-9]+$": {
//               type: "object",
//               properties: {
//                 main: { type: "boolean" },
//                 firstName: { type: "string" },
//                 lastName: { type: "string" },
//                 phone: { type: "string" },
//                 email: { type: "string", format: "email" },
//                 country: { type: "string" },
//                 document: {
//                   type: "object",
//                   properties: {
//                     type: { type: "string" },
//                     number: { type: "string" },
//                   },
//                 },
//                 birthdate: { type: "string", format: "date" },
//                 gender: { type: "string", enum: ["male", "female"] },
//                 ageGroup: {
//                   type: "string",
//                   enum: ["adult", "child", "infant", "senior"],
//                 },
//               },
//             },
//           },
//         },
//       },
//     },
//   },
 };
