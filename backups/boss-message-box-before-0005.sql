PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial.sql','2026-09-03 03:50:11');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_studio.sql','2026-09-03 12:24:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_fix_studio_admin_passwords.sql','2026-09-03 12:53:27');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_nickname_submission_and_moderation.sql','2026-09-04 11:21:25');
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone_encrypted TEXT NOT NULL,
  phone_hash TEXT NOT NULL UNIQUE,
  douyin_nickname TEXT NOT NULL CHECK (length(trim(douyin_nickname)) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE otp_phone_state (
  phone_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent')),
  lease_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  last_requested_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE otp_challenges (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 6),
  consumed_at INTEGER,
  invalidated_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE rate_limits (
  operation_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (operation_key, window_started_at)
);
INSERT INTO "rate_limits" ("operation_key","window_started_at","request_count","expires_at") VALUES('BrZFmuEr21rpeoaiJYmQmEz1bCfdQwzQO9iPPYXX-N0',1788600600000,1,1788602400000);
INSERT INTO "rate_limits" ("operation_key","window_started_at","request_count","expires_at") VALUES('3yA7G1lQpNnO9tV_BxwTEgPWGUN2k0oc5oKaXEWmM40',1788600600000,1,1788602400000);
CREATE TABLE image_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  not_before INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE
    CHECK (length(trim(username)) BETWEEN 1 AND 40),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);
INSERT INTO "admins" ("id","username","password_hash","created_at","updated_at","last_login_at") VALUES('admin-zd','zd','pbkdf2-sha256$100000$nVAZexYMWbKMc86O0pGZFg$OZ2s1PzKoJcnisM1p8n_zHWnL-t80zYEfwEJjARNs-Y',1788438269000,1788523594600,1788523594600);
INSERT INTO "admins" ("id","username","password_hash","created_at","updated_at","last_login_at") VALUES('admin-mm','mm','pbkdf2-sha256$100000$jiAxALcEdniEFcw8VxEBxA$hLDNsFYlWCGIEKu3mmJ_9Plinhzoq6XUg4SGcEXJ6e4',1788438269000,1788440007000,NULL);
INSERT INTO "admins" ("id","username","password_hash","created_at","updated_at","last_login_at") VALUES('admin-fa','fa','pbkdf2-sha256$100000$vwi6vv3gga6RL-tn-JfeuA$f-p2Wg88zQTFA9_dtCYEyMeaK4ZBGqvZatO2Tbz7Ij8',1788438269000,1788440007000,NULL);
INSERT INTO "admins" ("id","username","password_hash","created_at","updated_at","last_login_at") VALUES('admin-ceshi','ceshi','pbkdf2-sha256$100000$QUvTs5NL9IJQFZvp0N0wXQ$RaiWw0DYKVoXD1VGMRdv_yPuJcifzNC7MhRognnoiaY',1788438269000,1788600606085,1788600606085);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'live')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
INSERT INTO "admin_sessions" ("token_hash","admin_id","mode","created_at","expires_at") VALUES('txyZEf7TNmG1hB0aVb3dJ9-Qcw7R66kAyynoACYklYM','admin-zd','normal',1788523594600,1791115594600);
INSERT INTO "admin_sessions" ("token_hash","admin_id","mode","created_at","expires_at") VALUES('xuTSr_UzvcgD9tsQzZyvrGkDh0DeqoKw23XiPitKWRE','admin-ceshi','normal',1788600606085,1791192606085);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  douyin_nickname TEXT NOT NULL
    CHECK (length(trim(douyin_nickname)) BETWEEN 1 AND 40),
  topic TEXT NOT NULL
    CHECK (topic IN ('released_hardware', 'released_software', 'unreleased_product', 'appeal', 'other')),
  custom_topic TEXT,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  internal_status TEXT NOT NULL DEFAULT 'unprocessed'
    CHECK (internal_status IN ('unprocessed', 'pending_resolution', 'message_replied', 'livestream_replied')),
  reply_type TEXT CHECK (reply_type IN ('message', 'livestream')),
  reply_content TEXT,
  is_todo INTEGER NOT NULL DEFAULT 0 CHECK (is_todo IN (0, 1)),
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'kept', 'filtered', 'failed')),
  moderation_source TEXT
    CHECK (moderation_source IN ('ai', 'manual')),
  moderation_category TEXT
    CHECK (moderation_category IN ('valid_feedback', 'abusive', 'meaningless', 'uncertain')),
  moderation_reason TEXT CHECK (moderation_reason IS NULL OR length(moderation_reason) <= 160),
  moderated_at INTEGER,
  privacy_policy_version TEXT NOT NULL,
  privacy_agreed_at INTEGER NOT NULL,
  livestream_policy_version TEXT NOT NULL,
  livestream_agreed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (topic = 'other' AND custom_topic IS NOT NULL AND length(trim(custom_topic)) BETWEEN 1 AND 60)
    OR (topic <> 'other' AND custom_topic IS NULL)
  ),
  CHECK (
    (internal_status IN ('unprocessed', 'pending_resolution') AND reply_type IS NULL AND reply_content IS NULL)
    OR (internal_status = 'message_replied' AND reply_type = 'message' AND reply_content IS NOT NULL AND length(trim(reply_content)) > 0)
    OR (internal_status = 'livestream_replied' AND reply_type = 'livestream' AND reply_content IS NOT NULL AND length(trim(reply_content)) > 0)
  )
);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('0ddb185b-a1b8-445a-b6aa-17ed8377ac6b','ebd7b0d3-1546-49d8-8f94-73f3b088ebe3',NULL,'11','released_hardware',NULL,'11','unprocessed',NULL,NULL,0,'filtered','ai','meaningless','Content is just ''11'', which is meaningless spam with no useful feedback.',1788522557994,'2026-09-03',1788522557540,'2026-09-03',1788522557540,1788522557540,1788522557994);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('aac7b7d8-dd84-4fa2-8526-6879b46241a7','d8a1e9f3-cae0-46e8-826c-1ebd25b6ade8',NULL,'a','other','鹏友go pro插卡版一直没货','都等了3 4天了 一直不上架 问了 就等通知','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','User complains about product being out of stock and lack of information, a concrete service/inventory issue.',1788584045371,'2026-09-03',1788584044105,'2026-09-03',1788584044105,1788584044105,1788584045371);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('3ae2f9b8-bfb1-42dd-813a-78fcac1291db','b691fef6-1f7f-495c-ade6-3f80d91e5186',NULL,'晓辉','released_hardware',NULL,'建议在蜂窝设置里面放一个按钮，重播IP地址，进行IP地址切换。','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','用户提出具体的产品功能改进建议，属于有效反馈。',1788584569945,'2026-09-03',1788584568793,'2026-09-03',1788584568793,1788584568793,1788584569945);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('4c85fdc3-6400-4bab-a9f2-95c716fd0ad4','ae3a2704-749a-4c70-a889-11ae24f3e0a6',NULL,'shuip','unreleased_product',NULL,'期待鲲鹏粤星卡，一直在等鲲鹏的电信卡。希望能尽快推出。谢谢','unprocessed',NULL,NULL,0,'kept','manual',NULL,'manual_restore',1788585079235,'2026-09-03',1788584819917,'2026-09-03',1788584819917,1788584819917,1788585079235);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('4671fed6-3b44-41b2-b92f-4c35ddcf3fd1','1979f3ea-93e1-4f42-90cb-ffeb115c6f07',NULL,'🌈Alex','other','希望张导做一个张导开播了么wx小程序','张导 跟您提个建议 可以做一个张导开播了么vx小程序 一开播微信会有通知（可以参考陈泽开播了么），这样小助理就可以不用每个群都发通知了。','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','User provides a concrete product suggestion for a live-stream notification mini-program, which is useful feedback.',1788584853823,'2026-09-03',1788584851456,'2026-09-03',1788584851456,1788584851456,1788584853823);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('05b264de-b005-469d-a487-80833b424c2b','1db17c65-a8af-4d0a-8ea9-c048ff7f982b',NULL,'ceshi','released_hardware',NULL,'ceshi','unprocessed',NULL,NULL,0,'filtered','ai','meaningless','内容仅为测试字样，无具体产品问题或反馈意义。',1788584896728,'2026-09-03',1788584896336,'2026-09-03',1788584896336,1788584896336,1788584896728);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('a2bfb07b-b72f-4930-8f8a-fa960d9204ec','ac63722c-98e9-4d43-b05d-ceb13be09462',NULL,'冬季嘿','unreleased_product',NULL,replace('ultra 9 月底国庆前能发货吗？\n折叠天线可否展示','\n',char(10)),'unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','Customer asks legitimate pre-sales questions about shipping time and product feature display.',1788585160023,'2026-09-03',1788585159044,'2026-09-03',1788585159044,1788585159044,1788585160023);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('2d9c0748-c976-4777-9e8d-bd2273cbcaaa','bb0226c2-be53-4744-932b-1381619ce8c7',NULL,'🌈Alex','other','大号AI分身','大号AI分身什么时候落实，小号到1W粉也开。','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','User asks about implementation timeline for a feature, which is a valid product inquiry/suggestion.',1788585266828,'2026-09-03',1788585265726,'2026-09-03',1788585265726,1788585265726,1788585266828);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('2a0df605-ad92-4fa5-9c98-74677e6beeff','35189b5f-a4e9-4ddf-91ef-7f903bbcdc13',NULL,'🌈Alex','other','建议直播间封一次处罚张导一次','作为抖音主播要学习抖音直播规范，建议直播间封一次，处罚张导一次。','unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788585366166,'2026-09-03',1788585365087,'2026-09-03',1788585365087,1788585365087,1788585366166);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('88de8a61-dedf-4f98-9cb4-fb4f743fc8c3','4e0cb4a3-115c-436e-af47-8ba5bec43464',NULL,'🌈Alex','unreleased_product',NULL,'N5000后续会出外置天线版本吗。','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','A genuine product inquiry about a future external antenna version of the N5000; it expresses a potential user need and is meaningful feedback.',1788585423813,'2026-09-03',1788585422757,'2026-09-03',1788585422757,1788585422757,1788585423813);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('f1484a66-ad82-4ab8-aaac-aac07d202111','4032d1a2-3337-4454-9b57-a8a8a1f41669',NULL,'青止','unreleased_product',NULL,'我想要定向天线，能不能把价格打下来，有一个叫Hiveton HADM1 5G高增益定向天线 5G天线 定向天线，我觉得大小和max合适','unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788585648777,'2026-09-03',1788585646830,'2026-09-03',1788585646830,1788585646830,1788585648777);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('cb0ce931-d444-4bca-b10f-4215e372261b','ed32af45-f30c-4e3c-aaa1-32db3bc26a83',NULL,'精灵','unreleased_product',NULL,'张导，从上次匆匆见过那之前素未谋面的ak08定向天线，对其留下了深刻映像，然后突然有别的事情错过具体讲解了，这次留言测试一下这个留言板，一方面想向您具体了解一下这个产品各方面情况包括但不限于参数，使用场景等，另一方面呢想问问这个产品现在到什么进度了准备定价多少？能增强信号到一个什么程度？还请张导不吝讲解一番。','unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788587061674,'2026-09-03',1788587060628,'2026-09-03',1788587060628,1788587060628,1788587061674);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('29c9d9df-855a-45e7-8b3f-24a0d66651b4','29551550-a320-4bb1-acfb-515a7877071a',NULL,'百無丶禁忌','released_software',NULL,replace('鲲鹏无限APP每次进后台都需要管理员密码，很麻烦，3.0之前版本都不需要，我是主系统之前是不需要的，副系统需要密码我可以理解。\n    之前铝合金壳的图标问题，又顺着这次更新打回原形了，设备列表里面能看到的铝合金图标，从本机点进去就又变回塑料壳图标，希望张导抓紧完善一下。','\n',char(10)),'unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','用户反馈APP后台密码要求及图标显示问题，属于具体产品反馈。',1788591721430,'2026-09-03',1788591717863,'2026-09-03',1788591717863,1788591717863,1788591721430);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('d8db992c-8517-4539-95d6-2009bb30935b','0707c6a7-4242-49ac-b191-574b0f047aee',NULL,'哈吉森🧸.','appeal',NULL,'我下单的铝合金全新壳，为什么给我发的是瑕疵壳','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','Customer complains about receiving a defective case instead of the new aluminum case ordered, a concrete product/quality complaint.',1788592004081,'2026-09-03',1788592001374,'2026-09-03',1788592001374,1788592001374,1788592004081);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('b925e70e-5d31-46b1-a39c-4fefbf0c38fd','0fc9cb02-86c5-4fb6-a7f4-31f0754c5a75',NULL,'木子李','released_software',NULL,'C2000max云盘发布的op固件，文件夹2026年7月7日按照流程安装后，模组管理系统无法查看网络状态等相关信息！','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','用户反馈固件安装后模组管理系统无法查看网络状态，属于具体的软件故障描述，应保留。',1788594183137,'2026-09-03',1788594181376,'2026-09-03',1788594181376,1788594181376,1788594183137);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('f565609b-c7cd-4a1b-8063-34e771574baf','9bf55aa9-eb0c-4188-8303-d84cb95e4be4',NULL,'木子李','other','C2000MAX铝合金版本','标签掉色严重！','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','具体的产品质量抱怨：标签掉色严重，属于有效反馈。',1788594244200,'2026-09-03',1788594243435,'2026-09-03',1788594243435,1788594243435,1788594244200);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('332b5c51-089b-4e91-98aa-f371bbbd91a5','2d165ba6-7125-43c1-83c5-2e60b9343434',NULL,'随帆风景','other','以后直播能不能不迟到？','发了直播通知，咱要是没有不可抗力，能不能不迟到？每次迟到不是一家正规公司该做的事儿，冒昧问一下，开董事会，张导也迟到吗？','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','用户具体投诉直播迟到问题，属于服务质量反馈，应保留。',1788597804256,'2026-09-03',1788597802921,'2026-09-03',1788597802921,1788597802921,1788597804256);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('749d1922-ab42-480b-9b60-46dc7fc2fd07','a5e4d30e-a982-4a0b-861b-a34c112e2d2f',NULL,'说我就噜噜脸','released_hardware',NULL,replace('优化好金属壳表面工艺，背面建议也镀膜，还有亚克力板漏光问题\n当时看抖音说优化了，以为已经第二批了，没想到还是旧壳，有点失望，积极处理售后工作，加油导','\n',char(10)),'unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788604216907,'2026-09-03',1788604214805,'2026-09-03',1788604214805,1788604214805,1788604216907);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('73f4a6d0-77c3-4fcf-8496-932efd382d2a','e2fd2121-0282-45c8-93d8-0723b8a14b8c',NULL,'天使猪猪乐','other','张导的店特殊会员问题','为什么张导的店小程序有些东西需要特定会员购买，之前有c2000max原装拆机壳购买不了，而群里有些人就能购买。c2000max内测用户好久没关注过这方面了，只知道以前都是在鹏友go小程序上购买产品','unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788604232626,'2026-09-03',1788604231724,'2026-09-03',1788604231724,1788604231724,1788604232626);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('1b9ead85-dfcc-4412-8f8f-6a0045d2ee7d','92d64ce6-ba77-4a4b-b060-30462d38a452',NULL,'天使猪猪乐','other','c2000max bug反馈问题','c2000max反馈bug不方便，以前群里有发过反馈bug的链接，提交过一次之后遇到bug再想反馈的时候并不会刷新链接还是会显示以前填过的内容，而且后来这条链接也找不到了，现在想反馈问题就只能去微信联系个人反馈了，感觉十分不方便，希望能在web端后台或者app后台加一个反馈bug的窗口。另外每次更新只能在网盘或者群里查看更新日志以及系统包，这样也十分不方便，建议在后台加上历史更新日志（包含每个版本更新了什么内容修复了什么问题），如果能再提供一个历史版本下载按钮或者窗口就更好了，这样照顾不同群体的客户，用鲲鹏产品的人不一定每个都进群了也不定每个人都知道鲲鹏网盘地址。','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','User provides concrete usability complaints and product improvement suggestions regarding bug feedback channels and update logs.',1788604746627,'2026-09-03',1788604745650,'2026-09-03',1788604745650,1788604745650,1788604746627);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('f6cec3ee-fb51-47a3-a6f8-0810e583cc94','b4321ed8-be19-4c11-bf48-fd6eec70526c',NULL,'天使猪猪乐','other','继上一条反馈问题','如果app和网页端只能二选一的话，个人更希望那些功能加在web端后台（技术上如果能实现的话），因为app也不是每个人都会去下载，但是网页端是每个用户都会登进去访问的','unprocessed',NULL,NULL,0,'kept','ai','valid_feedback','User gives a concrete product suggestion about where to add features (web backend vs app), with reasoning, which is useful feedback.',1788605194824,'2026-09-03',1788605193935,'2026-09-03',1788605193935,1788605193935,1788605194824);
INSERT INTO "feedback" ("id","submission_key","user_id","douyin_nickname","topic","custom_topic","content","internal_status","reply_type","reply_content","is_todo","moderation_status","moderation_source","moderation_category","moderation_reason","moderated_at","privacy_policy_version","privacy_agreed_at","livestream_policy_version","livestream_agreed_at","created_at","updated_at") VALUES('34243920-1421-476c-acfd-09eb057d5a94','4113f3ea-63eb-471e-805f-868a1a1d09ff',NULL,'苏白ms','released_software',NULL,'c2000max定制的金属图标能否用自己提供的图片定制','unprocessed',NULL,NULL,0,'failed','ai',NULL,'provider_error',1788618940748,'2026-09-03',1788618939766,'2026-09-03',1788618939766,1788618939766,1788618940748);
CREATE TABLE feedback_images (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type = 'image/webp'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('5ab75051-2778-4afb-a160-ee47001c6a7b','4671fed6-3b44-41b2-b92f-4c35ddcf3fd1','feedback-images/4671fed6-3b44-41b2-b92f-4c35ddcf3fd1/ad7fe249-6e50-4366-a0ea-52f29744bc73.webp','image/webp',99316,1183,2560,'-NJhHLe35OXnipHpE0yiLOlf2DA4G5rE_e68a5G8x58',1788584851456);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('4ea2e2bb-1d05-44f0-8d42-fcc7dd6f998e','f1484a66-ad82-4ab8-aaac-aac07d202111','feedback-images/f1484a66-ad82-4ab8-aaac-aac07d202111/a13d6653-968a-40b1-a3c0-226570fa4cea.webp','image/webp',29102,1152,2560,'roPTz7e82049vZ4SC4SD9k1H5fJJW3E4BEQ2ZBZrAR4',1788585646830);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('ade4e0c6-69e2-4979-9c03-065af8004db8','f1484a66-ad82-4ab8-aaac-aac07d202111','feedback-images/f1484a66-ad82-4ab8-aaac-aac07d202111/c3fabe71-04ae-4d15-9f0b-d7a30870b7b4.webp','image/webp',38654,1120,1331,'SyOUnMO4FO6WuQzcNfEarOXgXQL5E20TaHarjJ3IVro',1788585646830);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('4603d36c-6fba-44cb-a577-55bac4e300d2','29c9d9df-855a-45e7-8b3f-24a0d66651b4','feedback-images/29c9d9df-855a-45e7-8b3f-24a0d66651b4/f6f8cef9-6a81-42da-b6c1-0f0b7b443a21.webp','image/webp',38376,1164,2560,'L-jQS7W4r36G4RN5gK5v-pg2gU0YEwh-j_rNjBrY_QI',1788591717863);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('3a41788b-d6e8-46c5-8be3-ebee18e32728','29c9d9df-855a-45e7-8b3f-24a0d66651b4','feedback-images/29c9d9df-855a-45e7-8b3f-24a0d66651b4/298b231e-0f93-4b8e-94ba-cec3d2f761ac.webp','image/webp',32850,1164,2560,'ah_5jSvCd-gxwayxCJWImC4nTHcdxfxxQFpi7OtSTQE',1788591717863);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('2979c5cb-8a5e-40ab-a55c-62bacc677d82','29c9d9df-855a-45e7-8b3f-24a0d66651b4','feedback-images/29c9d9df-855a-45e7-8b3f-24a0d66651b4/730fe0dc-f78e-4f7f-9fbe-edf4e4c1be59.webp','image/webp',57746,1164,2560,'zie3OGgm-snGH1Io7-bCUyCOfb6WN56_tWdUxrrRB0Q',1788591717863);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('ac9c62aa-4dfd-463e-b860-d5ba792d36a0','d8db992c-8517-4539-95d6-2009bb30935b','feedback-images/d8db992c-8517-4539-95d6-2009bb30935b/392df6ed-92aa-4a7d-8751-b1ce99e68613.webp','image/webp',199104,1441,2560,'zccjOjvbQIDo8NEQf4u7UMQWHXE6yxO_JfbafhQoSHg',1788592001374);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('153889d9-20b1-4663-9195-034c91ada888','d8db992c-8517-4539-95d6-2009bb30935b','feedback-images/d8db992c-8517-4539-95d6-2009bb30935b/8168035e-288c-4c17-adb8-29edb1c6f036.webp','image/webp',92970,1178,2560,'H_nkQZmKueUn2045Mhjzzv5A7XjnSCNu933gZPcOV1E',1788592001374);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('a968d2a1-abb3-4eb9-90bc-217de8424a27','b925e70e-5d31-46b1-a39c-4fefbf0c38fd','feedback-images/b925e70e-5d31-46b1-a39c-4fefbf0c38fd/9c8f66d3-df1b-4273-9ea7-2c8e854a5311.webp','image/webp',70580,1919,1080,'JkAgZ_PXenU7lBYzWiKhHBNZGNyB9zh2-DoAThdSTiQ',1788594181376);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('01e61aae-bcce-4988-ace1-5dd76adbc553','749d1922-ab42-480b-9b60-46dc7fc2fd07','feedback-images/749d1922-ab42-480b-9b60-46dc7fc2fd07/ec2cb737-99fa-47d4-8315-799df9d5d67f.webp','image/webp',229732,1920,2560,'K3tx3xwKkwnbbrPUHsDlBstNO-LjUD0o5385S6lQmGs',1788604214805);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('fce0608e-54d4-419b-a19c-89f364badd13','749d1922-ab42-480b-9b60-46dc7fc2fd07','feedback-images/749d1922-ab42-480b-9b60-46dc7fc2fd07/8d9c75a0-d138-4e50-8c26-d61fb0d64600.webp','image/webp',9050,1920,2560,'eEw8v4mu7VcIOjFTPQrkXIVoOsdS3ghw80xax7IBG6I',1788604214805);
INSERT INTO "feedback_images" ("id","feedback_id","object_key","media_type","byte_size","width","height","sha256","created_at") VALUES('cf6cecc0-647c-4c4a-868c-f818d7c1269a','749d1922-ab42-480b-9b60-46dc7fc2fd07','feedback-images/749d1922-ab42-480b-9b60-46dc7fc2fd07/0e273151-e98f-42f3-8843-eaa62abefcd2.webp','image/webp',7442,1440,2560,'Cx-xo7NKi7DMx3GcwMj4p0LDfaFPNi80L61uh_J8hVE',1788604214805);
CREATE TABLE feedback_replies (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  reply_type TEXT NOT NULL CHECK (reply_type IN ('live', 'message')),
  content TEXT NOT NULL,
  admin_id TEXT REFERENCES admins(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK (
    (admin_id IS NULL AND length(trim(content)) > 0)
    OR (admin_id IS NOT NULL AND length(trim(content)) BETWEEN 1 AND 2000)
  )
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  feedback_id TEXT REFERENCES feedback(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'reply_created',
      'todo_added',
      'todo_removed',
      'moderation_filtered',
      'moderation_restored'
    )
  ),
  created_at INTEGER NOT NULL
);
INSERT INTO "audit_logs" ("id","admin_id","feedback_id","action","created_at") VALUES('de11f4a9-f8de-4c4f-9b98-64de590eea6f','admin-zd','4c85fdc3-6400-4bab-a9f2-95c716fd0ad4','moderation_filtered',1788585077083);
INSERT INTO "audit_logs" ("id","admin_id","feedback_id","action","created_at") VALUES('066bf67e-c0ed-490c-adfe-bb0e8e9988bc','admin-zd','4c85fdc3-6400-4bab-a9f2-95c716fd0ad4','moderation_restored',1788585079235);
CREATE TABLE nickname_daily_limits (
  nickname TEXT NOT NULL,
  beijing_day TEXT NOT NULL,
  submission_count INTEGER NOT NULL CHECK (submission_count BETWEEN 1 AND 10),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (nickname, beijing_day)
);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('11','2026-09-04',1,1788522557540);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('a','2026-09-05',1,1788584044105);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('晓辉','2026-09-05',1,1788584568793);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('shuip','2026-09-05',1,1788584819917);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('🌈Alex','2026-09-05',4,1788585422757);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('ceshi','2026-09-05',1,1788584896336);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('冬季嘿','2026-09-05',1,1788585159044);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('青止','2026-09-05',1,1788585646830);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('精灵','2026-09-05',1,1788587060628);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('百無丶禁忌','2026-09-05',1,1788591717863);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('哈吉森🧸.','2026-09-05',1,1788592001374);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('木子李','2026-09-05',2,1788594243435);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('随帆风景','2026-09-05',1,1788597802921);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('说我就噜噜脸','2026-09-05',1,1788604214805);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('天使猪猪乐','2026-09-05',3,1788605193935);
INSERT INTO "nickname_daily_limits" ("nickname","beijing_day","submission_count","updated_at") VALUES('苏白ms','2026-09-05',1,1788618939766);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',4);
CREATE INDEX idx_otp_challenges_phone_sent ON otp_challenges(phone_hash, sent_at DESC);
CREATE INDEX idx_otp_challenges_expiry ON otp_challenges(expires_at);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX idx_image_cleanup_due ON image_cleanup_queue(not_before, attempt_count);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC, id DESC);
CREATE INDEX idx_feedback_nickname_created ON feedback(douyin_nickname, created_at DESC, id DESC);
CREATE INDEX idx_feedback_moderation_created ON feedback(moderation_status, created_at DESC, id DESC);
CREATE INDEX idx_feedback_todo_created ON feedback(is_todo, moderation_status, created_at DESC, id DESC);
CREATE INDEX idx_feedback_receipt_number ON feedback(upper(substr(id, 1, 8)));
CREATE INDEX idx_feedback_images_feedback ON feedback_images(feedback_id);
CREATE INDEX idx_feedback_replies_feedback_created ON feedback_replies(feedback_id, created_at, id);
CREATE INDEX idx_feedback_replies_feedback_type ON feedback_replies(feedback_id, reply_type);
CREATE INDEX idx_feedback_replies_created ON feedback_replies(created_at, feedback_id);
CREATE INDEX idx_audit_logs_feedback_created ON audit_logs(feedback_id, created_at);
CREATE INDEX idx_nickname_daily_limits_updated ON nickname_daily_limits(updated_at);
