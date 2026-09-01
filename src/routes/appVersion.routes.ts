/**
 * App version routes
 *
 * Public on purpose: the app has to be able to learn it is out of date before
 * logging in, and even when its session is dead.
 */
import express from 'express';
import * as appVersionCtrl from '../controllers/appVersion.controller';

const router = express.Router();

router.get('/', appVersionCtrl.getAppVersion);

export default router;
