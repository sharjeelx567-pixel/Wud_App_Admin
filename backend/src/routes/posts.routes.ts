import { Router } from 'express';
import { getPosts, hidePost, unhidePost, removePost, approvePost } from '../controllers/posts.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

// Rishta Posting moderation only — no comments (Rishta Posting has none;
// see community-posts.routes.ts for Community Discussion's post+comment
// moderation).
const router = Router();

router.use(authenticate);

router.get('/', requirePermission('posts.view'), getPosts);
router.patch('/:id/approve', requirePermission('posts.manage'), approvePost);
router.patch('/:id/hide', requirePermission('posts.manage'), hidePost);
router.patch('/:id/unhide', requirePermission('posts.manage'), unhidePost);
router.patch('/:id/remove', requirePermission('posts.manage'), removePost);

export default router;
