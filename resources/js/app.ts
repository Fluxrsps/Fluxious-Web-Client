/**
 * Mounts the client.
 *
 * One component, one mount point, no router: this site has a single page and it is the game. The
 * client's own runtime scripts (`public/client/web/*.js`) are loaded later by `bootClient`, which
 * `Client.vue` calls once it is on screen.
 */
import { createApp } from 'vue';
import Client from './Client.vue';

createApp(Client).mount('#app');
