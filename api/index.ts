import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config/env.js';
import { createMailer } from '../server/src/email/mailer.js';
import { createEventSink } from '../server/src/events/sink.js';
import { createGeo } from '../server/src/geo/index.js';
import { createMemberDirectory } from '../server/src/members/directory.js';
import { createStore } from '../server/src/storage/index.js';
import { createAiClient } from '../server/src/ai/client.js';
import { createDelivery } from '../server/src/leads/delivery.js';

let appHandler: any = null;

async function getHandler() {
  if (appHandler) return appHandler;

  const config = loadConfig(process.env);
  const geo = createGeo(config.paths.countiesFile);
  const directory = await createMemberDirectory({ config, geo });
  const store = createStore(config);
  await store.init();
  const events = createEventSink(store);
  const mailer = createMailer(config);
  const delivery = createDelivery({ mailer, store, events });
  const ai = createAiClient(config);

  appHandler = createApp({
    config,
    deps: {
      geo,
      directory,
      store,
      events,
      mailer,
      delivery,
      ai,
      rateLimitEnabled: true,
    },
  });

  return appHandler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getHandler();
  return app(req, res);
}

