import { Router } from 'express';
import {
  getPosts, approvePost, hidePost, unhidePost, removePost,
  getComments, hideComment, removeComment, restoreComment,
} from '../controllers/community-posts.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('posts.view'), getPosts);
router.patch('/:id/approve', requirePermission('posts.manage'), approvePost);
router.patch('/:id/hide', requirePermission('posts.manage'), hidePost);
router.patch('/:id/unhide', requirePermission('posts.manage'), unhidePost);
router.patch('/:id/remove', requirePermission('posts.manage'), removePost);

router.get('/comments', requirePermission('posts.view'), getComments);
router.patch('/:postId/comments/:commentId/hide', requirePermission('posts.manage'), hideComment);
router.patch('/:postId/comments/:commentId/remove', requirePermission('posts.manage'), removeComment);
router.patch('/:postId/comments/:commentId/restore', requirePermission('posts.manage'), restoreComment);

export default router;
